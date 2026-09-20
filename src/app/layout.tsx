import type { Metadata } from 'next';
import { Bricolage_Grotesque, Fira_Code, Source_Sans_3 } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});
const sans = Source_Sans_3({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-sans',
  display: 'swap',
});
const mono = Fira_Code({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Handoff',
  description: 'Project knowledge as a graph; the task decides which part an agent gets.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
