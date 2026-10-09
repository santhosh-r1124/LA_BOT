'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { DropdownMenu, MenuLabel, MenuRadio } from '@/components/dropdown-menu';
import { MoonIcon, SunIcon, type IconComponent } from '@/components/icons';
import { MonitorIcon } from '@/components/portal-icons';
import {
  applyThemeChoice,
  getServerThemeSnapshot,
  getThemeSnapshot,
  subscribeTheme,
  syncThemeColor,
  THEME_LABEL,
  type ThemeChoice,
} from '@/lib/theme';

const CHOICES: Array<{ value: ThemeChoice; Icon: IconComponent }> = [
  { value: 'light', Icon: SunIcon },
  { value: 'dark', Icon: MoonIcon },
  { value: 'system', Icon: MonitorIcon },
];

/** The current choice, read from `<html data-theme>`; "system" on the server. */
export function useThemeChoice(): [ThemeChoice, (next: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);

  // Keep the browser chrome colour in step with an explicit choice after load.
  useEffect(() => syncThemeColor(choice), [choice]);

  return [choice, applyThemeChoice];
}

/**
 * Header theme control: a menu with Light, Dark and System. The button shows a
 * moon in the dark theme and a sun in the light one, chosen by CSS (`.on-dark` /
 * `.on-light`), so it is right on first paint with no hydration mismatch.
 */
export function ThemeToggle() {
  const [choice, setChoice] = useThemeChoice();

  return (
    <DropdownMenu
      label="Theme"
      trigger={
        <>
          <MoonIcon className="on-dark size-5" />
          <SunIcon className="on-light size-5" />
        </>
      }
    >
      <MenuLabel>Theme</MenuLabel>
      {CHOICES.map(({ value, Icon }) => (
        <MenuRadio
          key={value}
          checked={choice === value}
          onSelect={() => setChoice(value)}
          icon={<Icon className="size-4 shrink-0" />}
        >
          {THEME_LABEL[value]}
        </MenuRadio>
      ))}
    </DropdownMenu>
  );
}

/** The same choice as a three-way segmented control, for the mobile menu. */
export function ThemeSwitch() {
  const [choice, setChoice] = useThemeChoice();

  return (
    <div role="group" aria-label="Theme" className="segmented w-full">
      {CHOICES.map(({ value, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          onClick={() => setChoice(value)}
          className="segment min-h-10 flex-1"
        >
          <Icon />
          {THEME_LABEL[value]}
        </button>
      ))}
    </div>
  );
}
