import type { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { TelegramAuthUser } from '@/lib/telegram';

type OptionKey = 'A' | 'B' | 'C' | 'D';

type QuestionRecord = {
  id: string;
  slug: string;
  question_text: string;
  question_type: string;
  image_url: string | null;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: OptionKey;
  explanation: string | null;
};

type QuizRecord = {
  id: string;
  quiz_date: string;
  title: string;
  description: string | null;
  time_limit_seconds: number;
  question_count: number;
};

type AttemptRecord = {
  id: string;
  user_id: string;
  daily_quiz_id: string;
  attempt_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  total_questions: number;
  answered_questions: number;
  correct_count: number;
  total_time_ms: number | null;
  score: number;
  created_at: string;
};

type AttemptItemRecord = {
  id: string;
  attempt_id: string;
  question_id: string;
  question_order: number;
  presented_option_keys: OptionKey[];
  selected_slot: number | null;
  is_correct: boolean | null;
  answered_at: string | null;
  time_spent_ms: number | null;
  game_question_bank: QuestionRecord | QuestionRecord[];
};

export type AttemptBundle = {
  attempt: AttemptRecord;
  quiz: QuizRecord;
  items: AttemptItemRecord[];
};

export type PublicQuestion = {
  questionOrder: number;
  questionId: string;
  slug: string;
  questionText: string;
  questionType: string;
  imageUrl: string | null;
  options: Array<{
    slot: number;
    text: string;
  }>;
  selectedSlot: number | null;
};

function unwrapRelation<T>(value: T | T[] | null | undefined): T {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error('GAME_ERROR: relation array is empty');
    }
    return value[0];
  }

  if (!value) {
    throw new Error('GAME_ERROR: relation is missing');
  }

  return value;
}

function shuffleArray<T>(source: T[]): T[] {
  const arr = [...source];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function getYesterdayDateString(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function getOptionText(question: QuestionRecord, optionKey: OptionKey): string {
  switch (optionKey) {
    case 'A':
      return question.option_a;
    case 'B':
      return question.option_b;
    case 'C':
      return question.option_c;
    case 'D':
      return question.option_d;
    default:
      return '';
  }
}

export function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || null;
  }

  return request.headers.get('x-real-ip') || null;
}

export async function ensureGameUser(telegramUser: TelegramAuthUser) {
  const supabase = getSupabaseAdmin();

  const payload = {
    telegram_id: telegramUser.telegramId,
    username: telegramUser.username,
    first_name: telegramUser.firstName || '',
    last_name: telegramUser.lastName,
    photo_url: telegramUser.photoUrl,
    last_seen_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('game_users')
    .upsert(payload, { onConflict: 'telegram_id' })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`GAME_ERROR: failed to upsert user: ${error?.message ?? 'unknown error'}`);
  }

  return data;
}

export async function getPublishedDailyQuiz(quizDate = getTodayDateString()) {
  const supabase = getSupabaseAdmin();

  const { data: quiz, error: quizError } = await supabase
    .from('game_daily_quizzes')
    .select('id, quiz_date, title, description, time_limit_seconds, question_count')
    .eq('quiz_date', quizDate)
    .eq('is_published', true)
    .maybeSingle();

  if (quizError) {
    throw new Error(`GAME_ERROR: failed to load daily quiz: ${quizError.message}`);
  }

  if (!quiz) {
    return null;
  }

  const { data: questionRows, error: questionError } = await supabase
    .from('game_daily_quiz_questions')
    .select(`
      question_id,
      sort_order,
      game_question_bank!game_daily_quiz_questions_question_id_fkey (
        id,
        slug,
        question_text,
        question_type,
        image_url,
        option_a,
        option_b,
        option_c,
        option_d,
        correct_option,
        explanation
      )
    `)
    .eq('daily_quiz_id', quiz.id)
    .order('sort_order', { ascending: true });

  if (questionError) {
    throw new Error(`GAME_ERROR: failed to load quiz questions: ${questionError.message}`);
  }

  const questions = (questionRows ?? []).map((row: any) => {
    const question = unwrapRelation<QuestionRecord>(row.game_question_bank);

    return {
      sort_order: row.sort_order,
      ...question,
    };
  });

  return {
    ...quiz,
    questions,
  };
}

export async function createAttemptWithItems(params: {
  userId: string;
  quizId: string;
  totalQuestions: number;
  questions: Array<{
    id: string;
  }>;
  ip: string | null;
  userAgent: string | null;
}) {
  const supabase = getSupabaseAdmin();

  const { data: attempt, error: attemptError } = await supabase
    .from('game_attempts')
    .insert({
      user_id: params.userId,
      daily_quiz_id: params.quizId,
      attempt_type: 'free',
      status: 'in_progress',
      total_questions: params.totalQuestions,
      answered_questions: 0,
      correct_count: 0,
      score: 0,
      ip: params.ip,
      user_agent: params.userAgent,
    })
    .select('*')
    .single();

  if (attemptError || !attempt) {
    const anyError = attemptError as any;
    if (anyError?.code === '23505') {
      throw anyError;
    }

    throw new Error(`GAME_ERROR: failed to create attempt: ${attemptError?.message ?? 'unknown error'}`);
  }

  const itemRows = params.questions.map((question, index) => ({
    attempt_id: attempt.id,
    question_id: question.id,
    question_order: index + 1,
    presented_option_keys: shuffleArray<OptionKey>(['A', 'B', 'C', 'D']),
  }));

  const { error: itemsError } = await supabase
    .from('game_attempt_items')
    .insert(itemRows);

  if (itemsError) {
    await supabase.from('game_attempts').delete().eq('id', attempt.id);
    throw new Error(`GAME_ERROR: failed to create attempt items: ${itemsError.message}`);
  }

  return attempt;
}

export async function getAttemptWithQuestions(attemptId: string, userId: string): Promise<AttemptBundle | null> {
  const supabase = getSupabaseAdmin();

  const { data: attemptRow, error: attemptError } = await supabase
    .from('game_attempts')
    .select(`
      id,
      user_id,
      daily_quiz_id,
      attempt_type,
      status,
      started_at,
      finished_at,
      total_questions,
      answered_questions,
      correct_count,
      total_time_ms,
      score,
      created_at,
      game_daily_quizzes!game_attempts_daily_quiz_id_fkey (
        id,
        quiz_date,
        title,
        description,
        time_limit_seconds,
        question_count
      )
    `)
    .eq('id', attemptId)
    .eq('user_id', userId)
    .maybeSingle();

  if (attemptError) {
    throw new Error(`GAME_ERROR: failed to load attempt: ${attemptError.message}`);
  }

  if (!attemptRow) {
    return null;
  }

  const quiz = unwrapRelation<QuizRecord>(attemptRow.game_daily_quizzes as any);

  const { data: itemRows, error: itemsError } = await supabase
    .from('game_attempt_items')
    .select(`
      id,
      attempt_id,
      question_id,
      question_order,
      presented_option_keys,
      selected_slot,
      is_correct,
      answered_at,
      time_spent_ms,
      game_question_bank!game_attempt_items_question_id_fkey (
        id,
        slug,
        question_text,
        question_type,
        image_url,
        option_a,
        option_b,
        option_c,
        option_d,
        correct_option,
        explanation
      )
    `)
    .eq('attempt_id', attemptId)
    .order('question_order', { ascending: true });

  if (itemsError) {
    throw new Error(`GAME_ERROR: failed to load attempt items: ${itemsError.message}`);
  }

  return {
    attempt: {
      id: attemptRow.id,
      user_id: attemptRow.user_id,
      daily_quiz_id: attemptRow.daily_quiz_id,
      attempt_type: attemptRow.attempt_type,
      status: attemptRow.status,
      started_at: attemptRow.started_at,
      finished_at: attemptRow.finished_at,
      total_questions: attemptRow.total_questions,
      answered_questions: attemptRow.answered_questions,
      correct_count: attemptRow.correct_count,
      total_time_ms: attemptRow.total_time_ms,
      score: attemptRow.score,
      created_at: attemptRow.created_at,
    },
    quiz,
    items: (itemRows ?? []) as AttemptItemRecord[],
  };
}

function buildPublicQuestion(item: AttemptItemRecord): PublicQuestion {
  const question = unwrapRelation<QuestionRecord>(item.game_question_bank);

  return {
    questionOrder: item.question_order,
    questionId: question.id,
    slug: question.slug,
    questionText: question.question_text,
    questionType: question.question_type,
    imageUrl: question.image_url,
    options: item.presented_option_keys.map((optionKey, index) => ({
      slot: index + 1,
      text: getOptionText(question, optionKey),
    })),
    selectedSlot: item.selected_slot,
  };
}

export function serializeAttemptBundle(bundle: AttemptBundle) {
  return {
    attempt: {
      id: bundle.attempt.id,
      status: bundle.attempt.status,
      startedAt: bundle.attempt.started_at,
      finishedAt: bundle.attempt.finished_at,
      totalQuestions: bundle.attempt.total_questions,
      answeredQuestions: bundle.attempt.answered_questions,
      correctCount: bundle.attempt.correct_count,
      totalTimeMs: bundle.attempt.total_time_ms,
      score: bundle.attempt.score,
    },
    quiz: {
      id: bundle.quiz.id,
      quizDate: bundle.quiz.quiz_date,
      title: bundle.quiz.title,
      description: bundle.quiz.description,
      timeLimitSeconds: bundle.quiz.time_limit_seconds,
      questionCount: bundle.quiz.question_count,
    },
    questions: bundle.items.map(buildPublicQuestion),
  };
}

function calculateCorrectCount(bundle: AttemptBundle): number {
  let correctCount = 0;

  for (const item of bundle.items) {
    const question = unwrapRelation<QuestionRecord>(item.game_question_bank);

    if (typeof item.selected_slot !== 'number') {
      continue;
    }

    const selectedKey = item.presented_option_keys[item.selected_slot - 1];
    if (selectedKey && selectedKey === question.correct_option) {
      correctCount += 1;
    }
  }

  return correctCount;
}

export function getAttemptSummary(bundle: AttemptBundle) {
  const startedAtMs = new Date(bundle.attempt.started_at).getTime();
  const limitMs = bundle.quiz.time_limit_seconds * 1000;

  if (
    bundle.attempt.status === 'completed' &&
    typeof bundle.attempt.total_time_ms === 'number'
  ) {
    return {
      answeredQuestions: bundle.attempt.answered_questions,
      correctCount: bundle.attempt.correct_count,
      totalQuestions: bundle.attempt.total_questions,
      totalTimeMs: bundle.attempt.total_time_ms,
      score: bundle.attempt.score,
      isExpired: bundle.attempt.total_time_ms >= limitMs,
    };
  }

  const answeredQuestions = bundle.items.filter(
    (item) => typeof item.selected_slot === 'number'
  ).length;

  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const totalTimeMs = Math.min(limitMs, elapsedMs);
  const correctCount = calculateCorrectCount(bundle);
  const score = correctCount * 1_000_000 - totalTimeMs;

  return {
    answeredQuestions,
    correctCount,
    totalQuestions: bundle.items.length,
    totalTimeMs,
    score,
    isExpired: elapsedMs >= limitMs,
  };
}

export function buildAnswerReview(bundle: AttemptBundle) {
  return bundle.items.map((item) => {
    const question = unwrapRelation<QuestionRecord>(item.game_question_bank);

    const correctSlot =
      item.presented_option_keys.findIndex(
        (optionKey) => optionKey === question.correct_option
      ) + 1;

    return {
      questionOrder: item.question_order,
      questionText: question.question_text,
      selectedSlot: item.selected_slot,
      correctSlot,
      isCorrect:
        typeof item.selected_slot === 'number'
          ? item.presented_option_keys[item.selected_slot - 1] === question.correct_option
          : false,
      explanation: question.explanation,
    };
  });
}

export async function getAttemptRank(dailyQuizId: string, attemptId: string) {
  const supabase = getSupabaseAdmin();

  const { data, error, count } = await supabase
    .from('game_attempts')
    .select('id', { count: 'exact' })
    .eq('daily_quiz_id', dailyQuizId)
    .eq('status', 'completed')
    .order('correct_count', { ascending: false })
    .order('total_time_ms', { ascending: true })
    .order('finished_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`GAME_ERROR: failed to load ranks: ${error.message}`);
  }

  const rows = data ?? [];
  const rankIndex = rows.findIndex((row) => row.id === attemptId);

  return {
    rank: rankIndex >= 0 ? rankIndex + 1 : null,
    totalPlayers: count ?? rows.length,
  };
}

export async function updateUserStatsAfterCompletion(userId: string) {
  const supabase = getSupabaseAdmin();

  const { data: user, error: userError } = await supabase
    .from('game_users')
    .select('id, streak_count, best_streak, total_games, last_played_date')
    .eq('id', userId)
    .single();

  if (userError || !user) {
    throw new Error(`GAME_ERROR: failed to load user stats: ${userError?.message ?? 'unknown error'}`);
  }

  const today = getTodayDateString();
  const yesterday = getYesterdayDateString();

  let nextStreak = 1;

  if (user.last_played_date === today) {
    nextStreak = Math.max(user.streak_count ?? 0, 1);
  } else if (user.last_played_date === yesterday) {
    nextStreak = (user.streak_count ?? 0) + 1;
  } else {
    nextStreak = 1;
  }

  const bestStreak = Math.max(user.best_streak ?? 0, nextStreak);
  const totalGames = (user.total_games ?? 0) + 1;

  const { data: updatedUser, error: updateError } = await supabase
    .from('game_users')
    .update({
      streak_count: nextStreak,
      best_streak: bestStreak,
      total_games: totalGames,
      last_played_date: today,
      last_seen_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select('*')
    .single();

  if (updateError || !updatedUser) {
    throw new Error(`GAME_ERROR: failed to update user stats: ${updateError?.message ?? 'unknown error'}`);
  }

  return updatedUser;
}