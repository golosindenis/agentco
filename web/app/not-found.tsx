import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap">
      <div className="top"><h1>Not here</h1></div>
      <p className="note">That draft or agent does not exist.</p>
      <Link href="/" className="btn back-today">Back to today</Link>
    </main>
  );
}
