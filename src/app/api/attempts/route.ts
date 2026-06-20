import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const telegramUserId = Number(body.telegramUserId ?? 0);
    const firstName =
      typeof body.firstName === "string" && body.firstName.trim()
        ? body.firstName.trim()
        : "Игрок";
    const score = Number(body.score);
    const totalQuestions = Number(body.totalQuestions);

    if (
      !Number.isFinite(telegramUserId) ||
      !Number.isFinite(score) ||
      !Number.isFinite(totalQuestions)
    ) {
      return NextResponse.json(
        { error: "Некорректные данные" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("quiz_attempts")
      .insert({
        telegram_user_id: telegramUserId,
        telegram_first_name: firstName,
        score,
        total_questions: totalQuestions,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Supabase attempts error:", error);

      return NextResponse.json(
        { error: "Не удалось сохранить результат" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      attemptId: data.id,
    });
  } catch (error) {
    console.error("POST /api/attempts unexpected error:", error);

    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}