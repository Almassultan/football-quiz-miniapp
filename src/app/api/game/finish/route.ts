import { NextRequest, NextResponse } from 'next/server';
import {
  buildAnswerReview,
  ensureGameUser,
  getAttemptRank,
  getAttemptSummary,
  getAttemptWithQuestions,
  updateUserStatsAfterCompletion,
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

    const body = await request.json();
    const attemptId = typeof body?.attemptId === 'string' ? body.attemptId : '';

    if (!attemptId) {
      return NextResponse.json({ error: 'attemptId is required' }, { status: 400 });
    }

    const bundle = await getAttemptWithQuestions(attemptId, user.id);

    if (!bundle) {
      return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
    }

    const summary = getAttemptSummary(bundle);
    const supabase = getSupabaseAdmin();

    let finalUser = user;

    if (bundle.attempt.status !== 'completed') {
      const startedAtMs = new Date(bundle.attempt.started_at).getTime();
      const finishedAtIso = new Date(startedAtMs + summary.totalTimeMs).toISOString();

      const { error: updateAttemptError } = await supabase
        .from('game_attempts')
        .update({
          status: 'completed',
          finished_at: finishedAtIso,
          answered_questions: summary.answeredQuestions,
          correct_count: summary.correctCount,
          total_questions: summary.totalQuestions,
          total_time_ms: summary.totalTimeMs,
          score: summary.score,
        })
        .eq('id', attemptId);

      if (updateAttemptError) {
        throw new Error(`GAME_ERROR: failed to finish attempt: ${updateAttemptError.message}`);
      }

      finalUser = await updateUserStatsAfterCompletion(user.id);
    }

    const refreshedBundle = await getAttemptWithQuestions(attemptId, user.id);

    if (!refreshedBundle) {
      throw new Error('GAME_ERROR: failed to reload completed attempt');
    }

    const finalSummary = getAttemptSummary(refreshedBundle);
    const rankInfo = await getAttemptRank(refreshedBundle.quiz.id, refreshedBundle.attempt.id);
    const answerReview = buildAnswerReview(refreshedBundle);

    return NextResponse.json({
      attempt: {
        id: refreshedBundle.attempt.id,
        status: 'completed',
      },
      quiz: {
        id: refreshedBundle.quiz.id,
        quizDate: refreshedBundle.quiz.quiz_date,
        title: refreshedBundle.quiz.title,
      },
      result: {
        correctCount: finalSummary.correctCount,
        answeredQuestions: finalSummary.answeredQuestions,
        totalQuestions: finalSummary.totalQuestions,
        totalTimeMs: finalSummary.totalTimeMs,
        totalTimeSeconds: Number((finalSummary.totalTimeMs / 1000).toFixed(1)),
        score: finalSummary.score,
      },
      leaderboard: rankInfo,
      streak: {
        current: finalUser.streak_count,
        best: finalUser.best_streak,
      },
      answers: answerReview,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: getErrorStatus(error) }
    );
  }
}