import Link from "next/link";

export default function CancelledPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-bold text-brand-900">Payment cancelled</h1>
      <p className="mt-2 text-sm text-brand-700">
        No payment was taken. You can try signing up again whenever you&apos;re ready.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white"
      >
        Back to signup
      </Link>
    </main>
  );
}
