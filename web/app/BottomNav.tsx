import Link from "next/link";

const ITEMS = [
  { href: "/", label: "Today" },
  { href: "/org", label: "Org" },
  { href: "/activity", label: "Activity" },
];

export function BottomNav({ active }: { active: string }) {
  return (
    <nav className="bottom-nav">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={item.href === active ? "nav-item on" : "nav-item"}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
