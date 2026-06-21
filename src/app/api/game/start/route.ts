import { NextRequest, NextResponse } from 'next/server';
import {
  createAttemptWithItems,
  ensureGameUser,
  getAttemptWithQuestions,
  getClientIp,
  getPublishedDailyQuiz,
  serializeAttemptBundle,
} from '@/lib/game';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  getTelegramUserFromHeaders,
  isConfigError,
  isTelegramAuthError,
} from '@/lib/telegram';

function getErrorStatus(error: unknown): number {
  if (isTelegramAuthError(error)) return 401;
  if (isConfigError(error)) return 500;
  return 500;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unknown server error';
}

export async function POST(request: NextRequest) {
  try {
    const telegramUser = getTelegramUserFromHeaders(request.headers);
    const user = await ensureGameUser(telegramUser);
    const quiz = await getPublishedDailyQuiz();

    if (!quiz) {
      return NextResponse.json(
        { error: 'Квиз дня не найден' },
        { status: 404 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: existingAttempt, error: existingError } = await supabase
      .from('game_attempts')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('daily_quiz_id', quiz.id)
      .eq('attempt_type', 'free')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(`GAME_ERROR: failed to load existing attempt: ${existingError.message}`);
    }

    if (existingAttempt?.status === 'completed') {
      return NextResponse.json(
        {
          code: 'ALREADY_PLAYED_TODAY',
          error: 'Сегодня бесплатная попытка уже использована',
        },
        { status: 409 }
      );
    }

    if (existingAttempt?.status === 'in_progress') {
      const bundle = await getAttemptWithQuestions(existingAttempt.id, user.id);

      if (!bundle) {
        throw new Error('GAME_ERROR: attempt exists but bundle is missing');
      }

      return NextResponse.json({
        resume: true,
        ...serializeAttemptBundle(bundle),
        serverTime: new Date().toISOString(),
      });
    }

    let attemptId: string;

    try {
      const attempt = await createAttemptWithItems({
        userId: user.id,
        quizId: quiz.id,
        totalQuestions: quiz.questions.length,
        questions: quiz.questions,
        ip: getClientIp(request),
        userAgent: request.headers.get('user-agent'),
      });

      attemptId = attempt.id;
    } catch (error: any) {
      if (error?.code === '23505') {
        const { data: raceAttempt } = await supabase
          .from('game_attempts')
          .select('id, status')
          .eq('user_id', user.id)
          .eq('daily_quiz_id', quiz.id)
          .eq('attempt_type', 'free')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (raceAttempt?.id) {
          const bundle = await getAttemptWithQuestions(raceAttempt.id, user.id);

          if (bundle) {
            return NextResponse.json({
              resume: true,
              ...serializeAttemptBundle(bundle),
              serverTime: new Date().toISOString(),
            });
          }
        }
      }

      throw error;
    }

    const bundle = await getAttemptWithQuestions(attemptId, user.id);

    if (!bundle) {
      throw new Error('GAME_ERROR: created attempt but bundle is missing');
    }

    return NextResponse.json({
      resume: false,
      ...serializeAttemptBundle(bundle),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: getErrorStatus(error) }
    );
  }
}