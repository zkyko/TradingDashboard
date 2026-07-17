import { notFound } from "next/navigation";
import { I18nProviderClient } from "@/locales/client";
import AppShell from "@/app/components/AppShell";
import LocaleDocumentSync from "@/app/components/LocaleDocumentSync";
import { getLocaleDir, isAppLocale } from "@/lib/locale";
import { getStaticParams } from "@/locales/server";

export function generateStaticParams() {
  return getStaticParams();
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isAppLocale(locale)) notFound();
  const dir = getLocaleDir(locale);

  return (
    <div lang={locale} dir={dir} data-locale={locale} className="locale-root">
      <I18nProviderClient locale={locale}>
        <LocaleDocumentSync />
        <AppShell>{children}</AppShell>
      </I18nProviderClient>
    </div>
  );
}
