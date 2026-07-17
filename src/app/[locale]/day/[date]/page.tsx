import { notFound } from "next/navigation";
import DayReview from "@/app/components/DayReview";
import { loadDay, loadDaysIndex } from "@/lib/review/load";

export function generateStaticParams() {
  return loadDaysIndex().days.map((d) => ({ date: d.date }));
}

export default async function DayPage({
  params,
}: {
  params: Promise<{ locale: string; date: string }>;
}) {
  const { locale, date } = await params;
  const day = loadDay(date);
  if (!day) notFound();
  return <DayReview day={day} locale={locale} />;
}
