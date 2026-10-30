'use client';

import { useEffect } from 'react';

/**
 * Global client bootstrap mounted once in the root layout:
 *  - registers the service worker so the site is installable as an app;
 *  - suppresses the context menu (desktop right-click, Android long-press
 *    menu) everywhere in the app, per the owner's no-copying order — paired
 *    with the user-select:none CSS in globals.css. The ONLY exception is
 *    form fields (input/textarea/contenteditable), where editing, selecting
 *    and pasting text must keep working normally.
 */
export default function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const t = e.target as Element | null;
      // Inside a form field the menu (paste etc.) stays available.
      if (
        t &&
        typeof t.closest === 'function' &&
        (t.closest('input,textarea,[contenteditable="true"]') ||
          (t as HTMLElement).isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  return null;
}
