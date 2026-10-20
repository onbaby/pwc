import { useEffect, useState } from "react";

/** A ~40-line hash router (spec 12.1): `#/customers/maya-thompson?tab=x`. */
export interface Route {
  path: string[];
  query: URLSearchParams;
}

const parse = (): Route => {
  const raw = window.location.hash.replace(/^#/, "") || "/today";
  const [p, q] = raw.split("?");
  return { path: p!.split("/").filter(Boolean), query: new URLSearchParams(q ?? "") };
};

export function useRoute(): Route {
  const [r, setR] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setR(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

export const go = (to: string): void => {
  window.location.hash = to.startsWith("#") ? to : `#${to}`;
};
export const href = (to: string): string => `#${to}`;
