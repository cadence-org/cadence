"use client";

import {
  PlusIcon,
  PencilSquareIcon,
  AcademicCapIcon,
} from "@heroicons/react/24/outline";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import Link from "next/link";

// Map of links to display in the side navigation.
// Depending on the size of the application, this would be stored in a database.
const links = [
  { name: "Create", href: "/create", icon: PlusIcon },
  { name: "Quiz", href: "/quiz", icon: AcademicCapIcon },
  {
    name: "Manage",
    href: "/manage",
    icon: PencilSquareIcon,
  },
];

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {links.map((link) => {
        const LinkIcon = link.icon;
        return (
          <Link
            key={link.name}
            href={link.href}
            className={clsx("flex text-sm font-medium gap-x-2 py-2", {
              "border-b border-white": pathname === link.href,
            })}
          >
            <div className="h-6 flex flex-col justify-around">
              <LinkIcon className="w-6" />
            </div>
            <p className="flex items-center justify-center text-center h-6 py-1 hidden md:block">
              {link.name}
            </p>
          </Link>
        );
      })}
    </>
  );
}
