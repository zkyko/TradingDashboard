import { notFound } from "next/navigation";
import WeekReview from "@/app/components/WeekReview";
import { loadBehavior, loadWeek, loadWeeksIndex } from "@/lib/review/load";

export function generateStaticParams() {
  return loadWeeksIndex().weeks.map((w) => ({ id: w.id }));
}

export default async function WeekDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  const week = loadWeek(id);
  if (!week) notFound();
  return <WeekReview week={week} behavior={loadBehavior()} />;
}
