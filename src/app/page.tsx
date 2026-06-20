"use client";

import { useEffect, useState } from "react";

type Question = {
  id: number;
  text: string;
  options: string[];
  correctAnswer: string;
};

const sampleQuestions: Question[] = [
  {
    id: 1,
    text: "Кто выиграл Чемпионат мира 2022?",
    options: ["Франция", "Аргентина", "Бразилия", "Германия"],
    correctAnswer: "Аргентина",
  },
  {
    id: 2,
    text: "Сколько игроков одной команды находятся на поле одновременно?",
    options: ["10", "11", "12", "9"],
    correctAnswer: "11",
  },
  {
    id: 3,
    text: "Какой клуб ассоциируется с Камп Ноу?",
    options: ["Реал Мадрид", "Атлетико", "Барселона", "Севилья"],
    correctAnswer: "Барселона",
  },
  {
    id: 4,
    text: "Сколько минут длится обычный футбольный матч без добавленного времени?",
    options: ["80", "100", "90", "70"],
    correctAnswer: "90",
  },
  {
    id: 5,
    text: "Как называется пенальти, если мяч забит ударом с 11 метров?",
    options: ["Штрафной", "Аут", "Офсайд", "Пенальти"],
    correctAnswer: "Пенальти",
  },
];

export default function HomePage() {
  const [isTelegram, setIsTelegram] = useState(false);
  const [userName, setUserName] = useState("Игрок");
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const tg = (window as any).Telegram?.WebApp;

    if (tg) {
      tg.ready();
      tg.expand();
      setIsTelegram(true);

      const firstName = tg.initDataUnsafe?.user?.first_name;
      if (firstName) {
        setUserName(firstName);
      }
    }
  }, []);

  const currentQuestion = sampleQuestions[currentQuestionIndex];
  const totalQuestions = sampleQuestions.length;

  const handleAnswer = (option: string) => {
    if (selectedOption) return;

    setSelectedOption(option);

    if (option === currentQuestion.correctAnswer) {
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

  const restartQuiz = () => {
    setStarted(false);
    setFinished(false);
    setCurrentQuestionIndex(0);
    setSelectedOption(null);
    setScore(0);
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-white px-4 py-6">
      <div className="mx-auto max-w-md">
        <div className="mb-6 rounded-2xl bg-zinc-900 p-4 shadow-lg">
          <p className="text-sm text-zinc-400">Telegram Mini App</p>
          <h1 className="mt-1 text-3xl font-bold">Football Quiz</h1>
          <p className="mt-2 text-zinc-300">
            Привет, <span className="font-semibold">{userName}</span>
          </p>
          {!isTelegram && (
            <p className="mt-3 rounded-lg bg-yellow-500/10 p-3 text-sm text-yellow-300">
              Сейчас ты открыл приложение не из Telegram. Это нормально для
              теста. Позже мы откроем его прямо внутри бота.
            </p>
          )}
        </div>

        {!started && !finished && (
          <div className="rounded-2xl bg-zinc-900 p-5 shadow-lg">
            <h2 className="text-xl font-semibold">Квиз дня</h2>
            <p className="mt-2 text-zinc-300">
              Ответь на {totalQuestions} вопросов про футбол.
            </p>

            <ul className="mt-4 space-y-2 text-sm text-zinc-400">
              <li>• 1 правильный ответ из 4</li>
              <li>• Сейчас это демо-версия</li>
              <li>• Позже добавим ежедневные вопросы и рейтинг</li>
            </ul>

            <button
              onClick={() => setStarted(true)}
              className="mt-6 w-full rounded-xl bg-green-500 px-4 py-3 font-semibold text-black transition hover:bg-green-400"
            >
              Начать игру
            </button>
          </div>
        )}

        {started && !finished && (
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
              {score === totalQuestions && "Идеально. Ты реально шаришь в футболе."}
              {score >= 3 && score < totalQuestions && "Хорошо. Уже неплохо, но можно лучше."}
              {score < 3 && "Это только начало. В следующей версии будет реванш."}
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
