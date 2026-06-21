import { NextRequest, NextResponse } from 'next/server';
import { ensureGameUser } from '@/lib/game';
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
    const questionOrder = Number(body?.questionOrder);
    const selectedSlot = Number(body?.selectedSlot);

    if (!attemptId) {
      return NextResponse.json({ error: 'attemptId is required' }, { status: 400 });
    }

    if (!Number.isInteger(questionOrder) || questionOrder < 1) {
      return NextResponse.json({ error: 'questionOrder is invalid' }, { status: 400 });
    }

    if (![1, 2, 3, 4].includes(selectedSlot)) {
      return NextResponse.json({ error: 'selectedSlot must be 1..4' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: attempt, error: attemptError } = await supabase
      .from('game_attempts')
      .select(`
        id,
        user_id,
        status,
        started_at,
        total_questions,
        answered_questions,
        game_daily_quizzes!game_attempts_daily_quiz_id_fkey (
          id,
          time_limit_seconds
        )
      `)
      .eq('id', attemptId)
      .eq('user_id', user.id)
      .single();

    if (attemptError || !attempt) {
      return NextResponse.json({ error: 'Попытка не найдена' }, { status: 404 });
    }

    if (attempt.status === 'completed') {
      return NextResponse.json(
        { error: 'Попытка уже завершена', code: 'ATTEMPT_ALREADY_COMPLETED' },
        { status: 409 }
      );
    }

    const quizRelation = Array.isArray(attempt.game_daily_quizzes)
      ? attempt.game_daily_quizzes[0]
      : attempt.game_daily_quizzes;

    const limitMs = Number(quizRelation?.time_limit_seconds ?? 60) * 1000;
    const startedAtMs = new Date(attempt.started_at).getTime();
    const nowMs = Date.now();
    const elapsedMs = nowMs - startedAtMs;

    if (elapsedMs >= limitMs) {
      return NextResponse.json(
        { error: 'Время вышло', code: 'TIME_EXPIRED' },
        { status: 410 }
      );
    }

    const { data: item, error: itemError } = await supabase
      .from('game_attempt_items')
      .select(`
        id,
        question_order,
        selected_slot,
        presented_option_keys,
        game_question_bank!game_attempt_items_question_id_fkey (
          correct_option
        )
      `)
      .eq('attempt_id', attemptId)
      .eq('question_order', questionOrder)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: 'Вопрос не найден в попытке' }, { status: 404 });
    }

    if (item.selected_slot !== null) {
      return NextResponse.json(
        { error: 'Ответ на этот вопрос уже сохранён', code: 'QUESTION_ALREADY_ANSWERED' },
        { status: 409 }
      );
    }

    const presentedOptionKeys: string[] = item.presented_option_keys ?? [];
    const selectedKey = presentedOptionKeys[selectedSlot - 1];

    if (!selectedKey) {
      return NextResponse.json({ error: 'Некорректный selectedSlot' }, { status: 400 });
    }

    const questionRelation = Array.isArray(item.game_question_bank)
      ? item.game_question_bank[0]
      : item.game_question_bank;

    const correctOption = questionRelation?.correct_option;
    const isCorrect = selectedKey === correctOption;
    const nowIso = new Date().toISOString();

    const { data: updatedItem, error: updateItemError } = await supabase
      .from('game_attempt_items')
      .update({
        selected_slot: selectedSlot,
        is_correct: isCorrect,
        answered_at: nowIso,
        time_spent_ms: null,
      })
      .eq('id', item.id)
      .is('selected_slot', null)
      .select('id')
      .maybeSingle();

    if (updateItemError) {
      throw new Error(`GAME_ERROR: failed to update answer: ${updateItemError.message}`);
    }

    if (!updatedItem) {
      return NextResponse.json(
        { error: 'Ответ на этот вопрос уже сохранён', code: 'QUESTION_ALREADY_ANSWERED' },
        { status: 409 }
      );
    }

    const answeredQuestions = Math.min(
      Number(attempt.total_questions ?? 0),
      Number(attempt.answered_questions ?? 0) + 1
    );

    const { error: updateAttemptError } = await supabase
      .from('game_attempts')
      .update({
        answered_questions: answeredQuestions,
      })
      .eq('id', attemptId);

    if (updateAttemptError) {
      throw new Error(`GAME_ERROR: failed to update attempt progress: ${updateAttemptError.message}`);
    }

    const remainingTimeMs = Math.max(0, limitMs - (Date.now() - startedAtMs));

    return NextResponse.json({
      ok: true,
      attemptId,
      questionOrder,
      answeredQuestions,
      totalQuestions: attempt.total_questions,
      isLastQuestion: answeredQuestions >= attempt.total_questions,
      remainingTimeMs,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: getErrorStatus(error) }
    );
  }
}