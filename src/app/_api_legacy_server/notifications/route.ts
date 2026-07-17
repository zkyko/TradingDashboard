import { NextResponse } from "next/server";
import {
  createPriceAlert,
  deletePriceAlert,
  listNotifications,
  listPriceAlerts,
  markAllNotificationsRead,
  markNotificationRead,
  setPriceAlertActive,
  unreadNotificationCount,
} from "@/lib/notifications";
import { getTraderPlan, saveTraderPlan } from "@/lib/trader-plan";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      notifications: listNotifications(100),
      unread: unreadNotificationCount(),
      alerts: listPriceAlerts(true),
      plan: getTraderPlan(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Notifications failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action || "");

    if (action === "create_alert") {
      const symbol = String(body.symbol || "").trim().toUpperCase();
      const direction = body.direction === "below" ? "below" : "above";
      const price = Number(body.price);
      if (!symbol || !Number.isFinite(price) || price <= 0) {
        throw new Error("Symbol and a positive price are required.");
      }
      const alert = createPriceAlert({
        symbol,
        direction,
        price,
        note: body.note ? String(body.note) : undefined,
      });
      return NextResponse.json({ ok: true, alert });
    }

    if (action === "delete_alert") {
      deletePriceAlert(String(body.id));
      return NextResponse.json({ ok: true });
    }

    if (action === "toggle_alert") {
      setPriceAlertActive(String(body.id), Boolean(body.active));
      return NextResponse.json({ ok: true });
    }

    if (action === "mark_read") {
      markNotificationRead(String(body.id), body.read !== false);
      return NextResponse.json({ ok: true, unread: unreadNotificationCount() });
    }

    if (action === "mark_all_read") {
      markAllNotificationsRead();
      return NextResponse.json({ ok: true, unread: 0 });
    }

    if (action === "save_plan") {
      const plan = saveTraderPlan({
        focus: body.focus != null ? String(body.focus) : undefined,
        process: body.process != null ? String(body.process) : undefined,
        goal: body.goal != null ? String(body.goal) : undefined,
        notes: body.notes != null ? String(body.notes) : undefined,
        noOptions: body.noOptions != null ? Boolean(body.noOptions) : undefined,
        writeBeforeTrade: body.writeBeforeTrade != null ? Boolean(body.writeBeforeTrade) : undefined,
        universe: Array.isArray(body.universe)
          ? body.universe.map((s: unknown) => String(s).trim().toUpperCase()).filter(Boolean)
          : undefined,
      });
      return NextResponse.json({ ok: true, plan });
    }

    throw new Error("Unknown action.");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action failed." },
      { status: 400 },
    );
  }
}
