'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTelegramInitData, initTelegramWebApp } from '@/lib/telegram-webapp';

type Screen = 'loading' | 'home' | 'quiz' | 'result';

type MeResponse = {
  user: {
    id: string;
    telegramId: number;
    username: string | null;
    firstName: string;
    lastName: string | null;
    photoUrl: string | null;
    streakCount: number;
    bestStreak: number;
    totalGames: number;
    lastPlayedDate: string | null;
  };
  todayQuiz: {
    id: string;
    quizDate: string;
    title: string;
    description: string | null;
    timeLimitSeconds: number;
    questionCount: number;
  } | null;
  todayAttempt: {
    id: string;
    status: 'in_progress' | 'completed' | 'expired' | 'abandoned';
    correct_count: number;
    total_time_ms: number | null;
    started_at: string;
    finished_at: string | null;
    answered_questions: number;
    total_questions: number;
  } | null;
  canPlayFreeToday: boolean;
  hasInProgressAttempt: boolean;
  serverTime: string;
};

type QuizQuestion = {
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

type StartResponse = {
  resume: boolean;
  attempt: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    totalQuestions: number;
    answeredQuestions: number;
    correctCount: number;
    totalTimeMs: number | null;
    score: number;
  };
  quiz: {
    id: string;
    quizDate: string;
    title: string;
    description: string | null;
    timeLimitSeconds: number;
    questionCount: number;
  };
  questions: QuizQuestion[];
  serverTime: string;
};

type AnswerResponse = {
  ok: boolean;
  attemptId: string;
  questionOrder: number;
  answeredQuestions: number;
  totalQuestions: number;
  isLastQuestion: boolean;
  remainingTimeMs: number;
  serverTime: string;
};

type FinishResponse = {
  attempt: {
    id: string;
    status: 'completed';
  };
  quiz: {
    id: string;
    quizDate: string;
    title: string;
  };
  result: {
    correctCount: number;
    answeredQuestions: number;
    totalQuestions: number;
    totalTimeMs: number;
    totalTimeSeconds: number;
    score: number;
  };
  leaderboard: {
    rank: number | null;
    totalPlayers: number;
  };
  streak: {
    current: number;
    best: number;
  };
  answers: Array<{
    questionOrder: number;
    questionText: string;
    selectedSlot: number | null;
    correctSlot: number;
    isCorrect: boolean;
    explanation: string | null;
  }>;
  serverTime: string;
};

type LeaderboardResponse = {
  quiz: {
    id: string;
    quizDate: string;
    title: string;
  };
  totalPlayers: number;
  entries: Array<{
    rank: number;
    attemptId: string;
    userId: string;
    displayName: string;
    correctCount: number;
    totalTimeMs: number | null;
  }>;
  myEntry: {
    attemptId: string;
    rank: number | null;
    totalPlayers: number;
    correctCount: number;
    totalTimeMs: number | null;
  } | null;
  serverTime: string;
};

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Неизвестная ошибка';
}

function formatTime(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDuration(ms: number | null): string {
  if (typeof ms !== 'number') return '—';
  return `${(ms / 1000).toFixed(1)} сек`;
}

function getNextUnansweredIndex(questions: QuizQuestion[]): number {
  const index = questions.findIndex((question) => question.selectedSlot === null);
  return index === -1 ? Math.max(questions.length - 1, 0) : index;
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  const initData = getTelegramInitData();

  if (initData) {
    headers.set('x-telegram-init-data', initData);
  }

  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return headers;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: buildHeaders(init),
    cache: 'no-store',
  });

  const raw = await response.text();

  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { error: raw || `HTTP ${response.status}` };
  }

  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }

  return data as T;
}

export default function HomePage() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [game, setGame] = useState<StartResponse | null>(null);
  const [result, setResult] = useState<FinishResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remainingTimeMs, setRemainingTimeMs] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');

  const finishingRef = useRef(false);

  const currentQuestion = useMemo(() => {
    if (!game) return null;
    return game.questions[currentIndex] ?? null;
  }, [game, currentIndex]);

  const loadMe = useCallback(async () => {
    const data = await apiFetch<MeResponse>('/api/me');
    setMe(data);
    return data;
  }, []);

  const loadLeaderboard = useCallback(async () => {
    try {
      const data = await apiFetch<LeaderboardResponse>('/api/leaderboard/daily');
      setLeaderboard(data);
    } catch (error) {
      console.error('Leaderboard load error:', error);
    }
  }, []);

  const handleFinish = useCallback(async () => {
    if (!game || finishingRef.current) return;

    finishingRef.current = true;
    setBusy(true);
    setError('');

    try {
      const data = await apiFetch<FinishResponse>('/api/game/finish', {
        method: 'POST',
        body: JSON.stringify({
          attemptId: game.attempt.id,
        }),
      });

      setResult(data);
      setScreen('result');
      await loadLeaderboard();
      await loadMe();
    } catch (error) {
      setError(readErrorMessage(error));
    } finally {
      setBusy(false);
      finishingRef.current = false;
    }
  }, [game, loadLeaderboard, loadMe]);

  useEffect(() => {
    initTelegramWebApp();

    void (async () => {
      try {
        setError('');
        await loadMe();
        setScreen('home');
      } catch (error) {
        setError(readErrorMessage(error));
        setScreen('home');
      }
    })();
  }, [loadMe]);

  useEffect(() => {
    if (screen !== 'quiz' || !game) return;

    const tick = () => {
      const endAt =
        new Date(game.attempt.startedAt).getTime() + game.quiz.timeLimitSeconds * 1000;
      const nextRemaining = Math.max(0, endAt - Date.now());

      setRemainingTimeMs(nextRemaining);

      if (nextRemaining <= 0) {
        void handleFinish();
      }
    };

    tick();
    const timer = window.setInterval(tick, 200);

    return () => {
      window.clearInterval(timer);
    };
  }, [screen, game, handleFinish]);

  const handleStart = useCallback(async () => {
    setBusy(true);
    setError('');

    try {
      const data = await apiFetch<StartResponse>('/api/game/start', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      setGame(data);
      setResult(null);
      setCurrentIndex(getNextUnansweredIndex(data.questions));
      setScreen('quiz');

      const endAt =
        new Date(data.attempt.startedAt).getTime() + data.quiz.timeLimitSeconds * 1000;
      setRemainingTimeMs(Math.max(0, endAt - Date.now()));
    } catch (error) {
      setError(readErrorMessage(error));
      await loadMe();
    } finally {
      setBusy(false);
    }
  }, [loadMe]);

  const handleAnswer = useCallback(
    async (selectedSlot: number) => {
      if (!game || !currentQuestion || busy) return;
      if (currentQuestion.selectedSlot !== null) return;

      setBusy(true);
      setError('');

      try {
        const data = await apiFetch<AnswerResponse>('/api/game/answer', {
          method: 'POST',
          body: JSON.stringify({
            attemptId: game.attempt.id,
            questionOrder: currentQuestion.questionOrder,
            selectedSlot,
          }),
        });

        const updatedQuestions = game.questions.map((question) =>
          question.questionOrder === currentQuestion.questionOrder
            ? { ...question, selectedSlot }
            : question
        );

        setGame({
          ...game,
          attempt: {
            ...game.attempt,
            answeredQuestions: data.answeredQuestions,
          },
          questions: updatedQuestions,
        });

        setRemainingTimeMs(data.remainingTimeMs);

        if (data.isLastQuestion) {
          await handleFinish();
          return;
        }

        setCurrentIndex(getNextUnansweredIndex(updatedQuestions));
      } catch (error) {
        const message = readErrorMessage(error);
        setError(message);

        if (
          message.includes('Время вышло') ||
          message.includes('ATTEMPT_ALREADY_COMPLETED')
        ) {
          await handleFinish();
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, currentQuestion, game, handleFinish]
  );

  const displayName = me?.user.username
    ? `@${me.user.username}`
    : me?.user.firstName || 'Игрок';

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-6">
        <header className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-white/50">
                Football Quiz
              </div>
              <h1 className="mt-1 text-2xl font-bold">Мини-игра дня</h1>
            </div>
            <button
              onClick={() => void loadMe()}
              className="rounded-xl border border-white/15 px-3 py-2 text-sm hover:bg-white/10"
              type="button"
            >
              Обновить
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">
            {error}
          </div>
        ) : null}

        {screen === 'loading' ? (
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            Загружаю...
          </section>
        ) : null}

        {screen === 'home' && me ? (
          <>
            <section className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm text-white/60">Игрок</div>
                <div className="mt-2 text-xl font-semibold">{displayName}</div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm text-white/60">Текущий стрик</div>
                <div className="mt-2 text-xl font-semibold">{me.user.streakCount}</div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm text-white/60">Лучший стрик</div>
                <div className="mt-2 text-xl font-semibold">{me.user.bestStreak}</div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-xl font-semibold">
                {me.todayQuiz?.title ?? 'Квиз дня пока не опубликован'}
              </h2>

              {me.todayQuiz ? (
                <>
                  <p className="mt-2 text-white/70">
                    {me.todayQuiz.description ?? 'Футбольные вопросы на время'}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-3 text-sm text-white/70">
                    <span className="rounded-full border border-white/10 px-3 py-1">
                      {me.todayQuiz.questionCount} вопросов
                    </span>
                    <span className="rounded-full border border-white/10 px-3 py-1">
                      {me.todayQuiz.timeLimitSeconds} секунд
                    </span>
                    <span className="rounded-full border border-white/10 px-3 py-1">
                      1 бесплатная попытка
                    </span>
                  </div>

                  {me.hasInProgressAttempt ? (
                    <button
                      onClick={() => void handleStart()}
                      disabled={busy}
                      className="mt-5 rounded-2xl bg-green-500 px-5 py-3 font-semibold text-black disabled:opacity-60"
                      type="button"
                    >
                      {busy ? 'Загрузка...' : 'Продолжить попытку'}
                    </button>
                  ) : me.canPlayFreeToday ? (
                    <button
                      onClick={() => void handleStart()}
                      disabled={busy}
                      className="mt-5 rounded-2xl bg-green-500 px-5 py-3 font-semibold text-black disabled:opacity-60"
                      type="button"
                    >
                      {busy ? 'Старт...' : 'Начать квиз'}
                    </button>
                  ) : (
                    <div className="mt-5 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-yellow-100">
                      Бесплатная попытка на сегодня уже использована
                    </div>
                  )}
                </>
              ) : null}
            </section>

            {me.todayAttempt ? (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h3 className="text-lg font-semibold">Статус сегодняшней попытки</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-white/10 p-3">
                    <div className="text-xs text-white/50">Статус</div>
                    <div className="mt-1 font-medium">{me.todayAttempt.status}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 p-3">
                    <div className="text-xs text-white/50">Отвечено</div>
                    <div className="mt-1 font-medium">
                      {me.todayAttempt.answered_questions}/{me.todayAttempt.total_questions}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 p-3">
                    <div className="text-xs text-white/50">Правильных</div>
                    <div className="mt-1 font-medium">{me.todayAttempt.correct_count}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 p-3">
                    <div className="text-xs text-white/50">Время</div>
                    <div className="mt-1 font-medium">
                      {formatDuration(me.todayAttempt.total_time_ms)}
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">Лидерборд дня</h3>
                <button
                  onClick={() => void loadLeaderboard()}
                  className="rounded-xl border border-white/15 px-3 py-2 text-sm hover:bg-white/10"
                  type="button"
                >
                  Загрузить
                </button>
              </div>

              {leaderboard ? (
                <div className="mt-4 space-y-3">
                  {leaderboard.entries.length === 0 ? (
                    <div className="text-white/60">Пока нет завершённых результатов</div>
                  ) : (
                    leaderboard.entries.slice(0, 10).map((entry) => (
                      <div
                        key={entry.attemptId}
                        className="flex items-center justify-between rounded-xl border border-white/10 p-3"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 text-center font-bold text-green-400">
                            #{entry.rank}
                          </div>
                          <div>{entry.displayName}</div>
                        </div>
                        <div className="text-sm text-white/70">
                          {entry.correctCount} / {formatDuration(entry.totalTimeMs)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="mt-4 text-white/60">Нажми «Загрузить»</div>
              )}
            </section>
          </>
        ) : null}

        {screen === 'quiz' && game && currentQuestion ? (
          <>
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-white/60">{game.quiz.title}</div>
                  <div className="mt-1 text-lg font-semibold">
                    Вопрос {currentQuestion.questionOrder} из {game.questions.length}
                  </div>
                </div>

                <div className="rounded-xl bg-red-500/15 px-4 py-2 text-lg font-bold text-red-200">
                  {formatTime(remainingTimeMs)}
                </div>
              </div>

              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{
                    width: `${(game.attempt.answeredQuestions / game.questions.length) * 100}%`,
                  }}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-xl font-semibold">{currentQuestion.questionText}</h2>

              <div className="mt-5 grid gap-3">
                {currentQuestion.options.map((option) => {
                  const isSelected = currentQuestion.selectedSlot === option.slot;

                  return (
                    <button
                      key={option.slot}
                      type="button"
                      disabled={busy || currentQuestion.selectedSlot !== null}
                      onClick={() => void handleAnswer(option.slot)}
                      className={`rounded-2xl border p-4 text-left transition ${
                        isSelected
                          ? 'border-green-400 bg-green-500/20'
                          : 'border-white/10 bg-white/5 hover:bg-white/10'
                      } disabled:opacity-70`}
                    >
                      <div className="text-sm text-white/50">Вариант {option.slot}</div>
                      <div className="mt-1 font-medium">{option.text}</div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => void handleFinish()}
                  disabled={busy}
                  className="rounded-2xl border border-white/15 px-4 py-3 hover:bg-white/10 disabled:opacity-60"
                >
                  Завершить сейчас
                </button>
              </div>
            </section>
          </>
        ) : null}

        {screen === 'result' && result ? (
          <>
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-2xl font-bold">Результат</h2>

              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-white/10 p-3">
                  <div className="text-xs text-white/50">Правильных</div>
                  <div className="mt-1 text-xl font-semibold">
                    {result.result.correctCount}/{result.result.totalQuestions}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 p-3">
                  <div className="text-xs text-white/50">Время</div>
                  <div className="mt-1 text-xl font-semibold">
                    {result.result.totalTimeSeconds} сек
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 p-3">
                  <div className="text-xs text-white/50">Место</div>
                  <div className="mt-1 text-xl font-semibold">
                    {result.leaderboard.rank ?? '—'}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 p-3">
                  <div className="text-xs text-white/50">Стрик</div>
                  <div className="mt-1 text-xl font-semibold">{result.streak.current}</div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setScreen('home')}
                  className="rounded-2xl bg-green-500 px-5 py-3 font-semibold text-black"
                >
                  На главную
                </button>

                <button
                  type="button"
                  onClick={() => void loadLeaderboard()}
                  className="rounded-2xl border border-white/15 px-5 py-3 hover:bg-white/10"
                >
                  Обновить лидерборд
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h3 className="text-lg font-semibold">Разбор ответов</h3>

              <div className="mt-4 space-y-3">
                {result.answers.map((answer) => (
                  <div
                    key={answer.questionOrder}
                    className="rounded-xl border border-white/10 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">
                        {answer.questionOrder}. {answer.questionText}
                      </div>
                      <div
                        className={`rounded-full px-3 py-1 text-sm ${
                          answer.isCorrect
                            ? 'bg-green-500/20 text-green-300'
                            : 'bg-red-500/20 text-red-300'
                        }`}
                      >
                        {answer.isCorrect ? 'Верно' : 'Неверно'}
                      </div>
                    </div>

                    <div className="mt-2 text-sm text-white/70">
                      Твой вариант: {answer.selectedSlot ?? '—'} · Правильный: {answer.correctSlot}
                    </div>

                    {answer.explanation ? (
                      <div className="mt-2 text-sm text-white/60">{answer.explanation}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            {leaderboard ? (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h3 className="text-lg font-semibold">Топ дня</h3>

                <div className="mt-4 space-y-3">
                  {leaderboard.entries.slice(0, 10).map((entry) => (
                    <div
                      key={entry.attemptId}
                      className="flex items-center justify-between rounded-xl border border-white/10 p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 text-center font-bold text-green-400">
                          #{entry.rank}
                        </div>
                        <div>{entry.displayName}</div>
                      </div>
                      <div className="text-sm text-white/70">
                        {entry.correctCount} / {formatDuration(entry.totalTimeMs)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}