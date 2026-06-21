import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("quiz_questions")
      .select(
        "id, question_text, option_a, option_b, option_c, option_d, correct_answer, sort_order"
      )
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("Supabase questions error:", error);

      return NextResponse.json(
        { error: "Не удалось загрузить вопросы" },
        { status: 500 }
      );
    }

    const questions = (data ?? []).map((row) => {
      const options = [row.option_a, row.option_b, row.option_c, row.option_d];

      const correctAnswer =
        row.correct_answer === "A"
          ? row.option_a
          : row.correct_answer === "B"
          ? row.option_b
          : row.correct_answer === "C"
          ? row.option_c
          : row.option_d;

      return {
        id: row.id,
        text: row.question_text,
        options,
        correctAnswer,
      };
    });

    return NextResponse.json({ questions });
  } catch (error) {
    console.error("GET /api/questions unexpected error:", error);

    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}