import { NextRequest, NextResponse } from 'next/server';
import { ensureGameUser, getPublishedDailyQuiz } from '@/lib/game';
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

export async function GET(request: NextRequest) {
  try {
    const telegramUser = getTelegramUserFromHeaders(request.headers);
    const user = await ensureGameUser(telegramUser);
    const quiz = await getPublishedDailyQuiz();

    let todayAttempt: any = null;

    if (quiz) {
      const { data, error } = await getSupabaseAdmin()
        .from('game_attempts')
        .select(`
          id,
          status,
          correct_count,
          total_time_ms,
          started_at,
          finished_at,
          answered_questions,
          total_questions
        `)
        .eq('user_id', user.id)
        .eq('daily_quiz_id', quiz.id)
        .eq('attempt_type', 'free')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(`GAME_ERROR: failed to load today attempt: ${error.message}`);
      }

      todayAttempt = data ?? null;
    }

    return NextResponse.json({
      user: {
        id: user.id,
        telegramId: user.telegram_id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        photoUrl: user.photo_url,
        streakCount: user.streak_count,
        bestStreak: user.best_streak,
        totalGames: user.total_games,
        lastPlayedDate: user.last_played_date,
      },
      todayQuiz: quiz
        ? {
            id: quiz.id,
            quizDate: quiz.quiz_date,
            title: quiz.title,
            description: quiz.description,
            timeLimitSeconds: quiz.time_limit_seconds,
            questionCount: quiz.question_count,
          }
        : null,
      todayAttempt,
      canPlayFreeToday: !todayAttempt || todayAttempt.status !== 'completed',
      hasInProgressAttempt: todayAttempt?.status === 'in_progress',
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: getErrorStatus(error) }
    );
  }
}