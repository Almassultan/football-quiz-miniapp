import { NextRequest, NextResponse } from 'next/server';
import { ensureGameUser, getAttemptRank, getPublishedDailyQuiz } from '@/lib/game';
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

    if (!quiz) {
      return NextResponse.json({ error: 'Квиз дня не найден' }, { status: 404 });
    }

    const supabase = getSupabaseAdmin();

    const { count: totalPlayers, error: countError } = await supabase
      .from('game_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('daily_quiz_id', quiz.id)
      .eq('status', 'completed');

    if (countError) {
      throw new Error(`GAME_ERROR: failed to count leaderboard players: ${countError.message}`);
    }

    const { data: rows, error: rowsError } = await supabase
      .from('game_attempts')
      .select(`
        id,
        user_id,
        correct_count,
        total_time_ms,
        finished_at,
        game_users!game_attempts_user_id_fkey (
          id,
          username,
          first_name
        )
      `)
      .eq('daily_quiz_id', quiz.id)
      .eq('status', 'completed')
      .order('correct_count', { ascending: false })
      .order('total_time_ms', { ascending: true })
      .order('finished_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(50);

    if (rowsError) {
      throw new Error(`GAME_ERROR: failed to load leaderboard: ${rowsError.message}`);
    }

    const entries = (rows ?? []).map((row: any, index) => {
      const profile = Array.isArray(row.game_users) ? row.game_users[0] : row.game_users;
      const displayName =
        profile?.username
          ? `@${profile.username}`
          : profile?.first_name || `Игрок ${index + 1}`;

      return {
        rank: index + 1,
        attemptId: row.id,
        userId: row.user_id,
        displayName,
        correctCount: row.correct_count,
        totalTimeMs: row.total_time_ms,
      };
    });

    const { data: myBestAttempt, error: myBestError } = await supabase
      .from('game_attempts')
      .select('id, correct_count, total_time_ms')
      .eq('daily_quiz_id', quiz.id)
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .order('correct_count', { ascending: false })
      .order('total_time_ms', { ascending: true })
      .order('finished_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (myBestError) {
      throw new Error(`GAME_ERROR: failed to load my best attempt: ${myBestError.message}`);
    }

    let myEntry = null;

    if (myBestAttempt) {
      const rankInfo = await getAttemptRank(quiz.id, myBestAttempt.id);

      myEntry = {
        attemptId: myBestAttempt.id,
        rank: rankInfo.rank,
        totalPlayers: rankInfo.totalPlayers,
        correctCount: myBestAttempt.correct_count,
        totalTimeMs: myBestAttempt.total_time_ms,
      };
    }

    return NextResponse.json({
      quiz: {
        id: quiz.id,
        quizDate: quiz.quiz_date,
        title: quiz.title,
      },
      totalPlayers: totalPlayers ?? entries.length,
      entries,
      myEntry,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: getErrorStatus(error) }
    );
  }
}