"use client";

import { useCallback, useEffect, useState } from "react";

type Question = {
  id: number;
  text: string;
  options: string[];
  correctAnswer: string;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function HomePage() {
  const [isTelegram, setIsTelegram] = useState(false);
  const [telegramUserId, setTelegramUserId] = useState(0);
  const [userName, setUserName] = useState("Игрок");

  const [questions, setQuestions] = useState<Question[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [questionsError, setQuestionsError] = useState("");

  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [score, setScore] = useState(0);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const tg = (window as Window & {
      Telegram?: {
        WebApp?: {
          ready: () => void;
          expand: () => void;
          initDataUnsafe?: {
            user?: {
              id?: number;
              first_name?: string;
            };
          };
        };
      };
    }).Telegram?.WebApp;

    if (tg) {
      tg.ready();
      tg.expand();
      setIsTelegram(true);

      const firstName = tg.initDataUnsafe?.user?.first_name;
      const userId = tg.initDataUnsafe?.user?.id;

      if (firstName) {
        setUserName(firstName);
      }

      if (userId) {
        setTelegramUserId(Number(userId));
      }
    }
  }, []);

  const loadQuestions = useCallback(async () => {
    try {
      setLoadingQuestions(true);
      setQuestionsError("");

      const response = await fetch("/api/questions", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Не удалось загрузить вопросы");
      }

      const data = await response.json();
      setQuestions(data.questions ?? []);
    } catch (error) {
      console.error(error);
      setQuestionsError("Не удалось загрузить вопросы из базы данных.");
    } finally {
      setLoadingQuestions(false);
    }
  }, []);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  const totalQuestions = questions.length;
  const currentQuestion = questions[currentQuestionIndex];

  const handleAnswer = (option: string) => {
    if (!currentQuestion || selectedOption) return;

    const isCorrect = option === currentQuestion.correctAnswer;

    setSelectedOption(option);

    if (isCorrect) {
      setScore((prev) => prev + 1);
    }

    setTimeout(() => {
      const isLastQuestion = currentQuestionIndex === totalQuestions - 1;

      if (isLastQuestion) {
        setFinished(true);
      } else {
        setCurrentQuestionIndex((prev) => prev + 1);
        setSelectedOption(null);
      }
    }, 700);
  };

  useEffect(() => {
    if (!finished || saveStatus !== "idle" || totalQuestions === 0) return;

    const finalScore = score;

    const saveAttempt = async () => {
      try {
        setSaveStatus("saving");

        const response = await fetch("/api/attempts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            telegramUserId,
            firstName: userName,
            score: finalScore,
            totalQuestions,
          }),
        });

        if (!response.ok) {
          throw new Error("Не удалось сохранить результат");
        }

        setSaveStatus("saved");
      } catch (error) {
        console.error(error);
        setSaveStatus("error");
      }
    };

    saveAttempt();
  }, [finished, saveStatus, telegramUserId, userName, score, totalQuestions]);

  const restartQuiz = () => {
    setStarted(false);
    setFinished(false);
    setCurrentQuestionIndex(0);
    setSelectedOption(null);
    setScore(0);
    setSaveStatus("idle");
  };

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-6 text-white">
      <div className="mx-auto max-w-md">
        <div className="mb-6 rounded-2xl bg-zinc-900 p-4 shadow-lg">
          <p className="text-sm text-zinc-400">Telegram Mini App</p>
          <h1 className="mt-1 text-3xl font-bold">Football Quiz</h1>
          <p className="mt-2 text-zinc-300">
            Привет, <span className="font-semibold">{userName}</span>
          </p>

          {!isTelegram && (
            <p className="mt-3 rounded-lg bg-yellow-500/10 p-3 text-sm text-yellow-300">
              Сейчас приложение открыто не из Telegram. Для локального теста это
              нормально.
            </p>
          )}
        </div>

        {loadingQuestions && (
          <div className="rounded-2xl bg-zinc-900 p-5 shadow-lg">
            <p className="text-zinc-300">Загружаем вопросы из базы данных...</p>
          </div>
        )}

        {!loadingQuestions && questionsError && (
          <div className="rounded-2xl bg-zinc-900 p-5 shadow-lg">
            <p className="text-red-400">{questionsError}</p>
            <button
              onClick={loadQuestions}
              className="mt-4 w-full rounded-xl bg-white px-4 py-3 font-semibold text-black transition hover:bg-zinc-200"
            >
              Попробовать снова
            </button>
          </div>
        )}

        {!loadingQuestions &&
          !questionsError &&
          totalQuestions > 0 &&
          !started &&
          !finished && (
            <div className="rounded-2xl bg-zinc-900 p-5 shadow-lg">
              <h2 className="text-xl font-semibold">Квиз дня</h2>
              <p className="mt-2 text-zinc-300">
                Ответь на {totalQuestions} вопросов про футбол.
              </p>

              <ul className="mt-4 space-y-2 text-sm text-zinc-400">
                <li>• Вопросы теперь приходят из базы данных</li>
                <li>• Результат будет сохранён</li>
                <li>• Это уже нормальная база для продукта</li>
              </ul>

              <button
                onClick={() => setStarted(true)}
                className="mt-6 w-full rounded-xl bg-green-500 px-4 py-3 font-semibold text-black transition hover:bg-green-400"
              >
                Начать игру
              </button>
            </div>
          )}

        {!loadingQuestions && !questionsError && totalQuestions === 0 && (
          <div className="rounded-2xl bg-zinc-900 p-5 shadow-lg">
            <p className="text-zinc-300">
              В базе пока нет вопросов. Добавь их в Supabase.
            </p>
          </div>
        )}

        {started && !finished && currentQuestion && (
          <div className="rounded-2xl bg-zinc-900 p-5 shadow-lg">
            <div className="mb-4 flex items-center justify-between text-sm text-zinc-400">
              <span>
                Вопрос {currentQuestionIndex + 1} / {totalQuestions}
              </span>
              <span>Очки: {score}</span>
            </div>

            <h2 className="text-xl font-semibold">{currentQuestion.text}</h2>

            <div className="mt-5 space-y-3">
              {currentQuestion.options.map((option) => {
                const isCorrect = option === currentQuestion.correctAnswer;
                const isSelected = selectedOption === option;

                let buttonClass =
                  "w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-left transition ";

                if (selectedOption) {
                  if (isCorrect) {
                    buttonClass += "border-green-500 bg-green-500/20";
                  } else if (isSelected) {
                    buttonClass += "border-red-500 bg-red-500/20";
                  } else {
                    buttonClass += "opacity-70";
                  }
                } else {
                  buttonClass += "hover:bg-zinc-700";
                }

                return (
                  <button
                    key={option}
                    onClick={() => handleAnswer(option)}
                    disabled={!!selectedOption}
                    className={buttonClass}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {finished && (
          <div className="rounded-2xl bg-zinc-900 p-5 shadow-lg">
            <h2 className="text-2xl font-bold">Результат</h2>

            <p className="mt-3 text-lg">
              Ты набрал <span className="font-bold text-green-400">{score}</span>{" "}
              из {totalQuestions}
            </p>

            <div className="mt-4 rounded-xl bg-zinc-800 p-4 text-zinc-300">
              {score === totalQuestions &&
                "Идеально. Ты реально шаришь в футболе."}
              {score >= 3 &&
                score < totalQuestions &&
                "Хорошо. Уже неплохо, но можно лучше."}
              {score < 3 && "Это только начало. В следующей версии будет реванш."}
            </div>

            <div className="mt-4 rounded-xl bg-zinc-800 p-4 text-sm text-zinc-300">
              {saveStatus === "saving" && "Сохраняем результат в базу данных..."}
              {saveStatus === "saved" && "Результат успешно сохранён."}
              {saveStatus === "error" &&
                "Не удалось сохранить результат. Играть можно, но запись в базу не прошла."}
            </div>

            <button
              onClick={restartQuiz}
              className="mt-6 w-full rounded-xl bg-white px-4 py-3 font-semibold text-black transition hover:bg-zinc-200"
            >
              Сыграть ещё раз
            </button>
          </div>
        )}
      </div>
    </main>
  );
}