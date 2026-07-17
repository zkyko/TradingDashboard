import Link from "next/link";

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** Static hosting root — jump into the default locale. */
export default function RootPage() {
  return (
    <main className="review-page" style={{ padding: 48 }}>
      <p className="review-eyebrow">Zkyko</p>
      <h1>Journal</h1>
      <p>
        <Link href="/en/">Open this week →</Link>
      </p>
      <script
        dangerouslySetInnerHTML={{
          __html: `try{location.replace(${JSON.stringify(`${base}/en/`)})}catch(e){}`,
        }}
      />
    </main>
  );
}
