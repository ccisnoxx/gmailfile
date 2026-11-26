import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type BrandEntry = {
  key: string;
  aliases: readonly string[];
  domain: string;
  render: (className: string) => ReactNode;
};

const BRAND_ENTRIES: readonly BrandEntry[] = [
  {
    key: 'claude',
    aliases: ['claude', 'anthropic', 'claudeai', 'claude.ai'],
    domain: 'claude.ai',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#D97757" />
        <path
          d="M12 4.8L13.5 9.6L17.9 7.1L15.1 11.2L19.4 12.8L14.6 13.7L16.3 18.4L12 15.2L7.7 18.4L9.4 13.7L4.6 12.8L8.9 11.2L6.1 7.1L10.5 9.6L12 4.8Z"
          fill="#FFF7F3"
        />
      </svg>
    ),
  },
  {
    key: 'chatgpt',
    aliases: ['chatgpt', 'openai', 'gpt', 'chatgpt.com', 'openai.com'],
    domain: 'chatgpt.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#10A37F" />
        <g stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 6.2a3.3 3.3 0 0 1 3.1 2.2l.4 1.1" />
          <path d="M17 9.1a3.3 3.3 0 0 1-.4 3.8l-.8.9" />
          <path d="M17 14.9a3.3 3.3 0 0 1-3.5 1.5l-1.1-.3" />
          <path d="M12 17.8a3.3 3.3 0 0 1-3.1-2.2l-.4-1.1" />
          <path d="M7 14.9a3.3 3.3 0 0 1 .4-3.8l.8-.9" />
          <path d="M7 9.1a3.3 3.3 0 0 1 3.5-1.5l1.1.3" />
          <polygon points="12,9.7 14,10.85 14,13.15 12,14.3 10,13.15 10,10.85" />
        </g>
      </svg>
    ),
  },
  {
    key: 'cursor',
    aliases: ['cursor', 'cursor.com', 'cursor.sh'],
    domain: 'cursor.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#171923" />
        <path d="M12 4.5L18.5 8.25V15.75L12 19.5L5.5 15.75V8.25L12 4.5Z" fill="#2D3748" />
        <path d="M12 4.5L18.5 8.25L12 12L5.5 8.25L12 4.5Z" fill="#E2E8F0" />
        <path d="M18.5 8.25V15.75L12 19.5V12L18.5 8.25Z" fill="#94A3B8" />
        <path d="M12 12V19.5L5.5 15.75V8.25L12 12Z" fill="#475569" />
      </svg>
    ),
  },
  {
    key: 'gemini',
    aliases: ['gemini', 'bard', 'gemini.google.com', 'aistudio', 'googleaistudio'],
    domain: 'gemini.google.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#EEF4FF" />
        <path
          d="M12 4C12.7 8.4 15.6 11.3 20 12C15.6 12.7 12.7 15.6 12 20C11.3 15.6 8.4 12.7 4 12C8.4 11.3 11.3 8.4 12 4Z"
          fill="#4285F4"
        />
        <path
          d="M12 4C12.7 8.4 15.6 11.3 20 12C15.6 12.7 12.7 15.6 12 20"
          fill="#8E75FF"
          fillOpacity="0.65"
        />
      </svg>
    ),
  },
  {
    key: 'github',
    aliases: ['github', 'github.com', 'gh'],
    domain: 'github.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#181717" />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 5.2a6.8 6.8 0 0 0-2.15 13.25c.34.06.46-.15.46-.33v-1.26c-1.89.41-2.29-.8-2.29-.8-.31-.78-.75-.99-.75-.99-.62-.42.05-.41.05-.41.68.05 1.04.7 1.04.7.61 1.04 1.6.74 1.99.57.06-.44.24-.74.43-.91-1.51-.17-3.1-.76-3.1-3.36 0-.74.27-1.35.7-1.82-.07-.17-.3-.86.07-1.8 0 0 .57-.18 1.87.7a6.5 6.5 0 0 1 3.4 0c1.3-.88 1.87-.7 1.87-.7.37.94.14 1.63.07 1.8.44.47.7 1.08.7 1.82 0 2.61-1.59 3.19-3.11 3.36.25.21.46.63.46 1.26v1.87c0 .18.12.39.47.33A6.8 6.8 0 0 0 12 5.2Z"
          fill="#FFFFFF"
        />
      </svg>
    ),
  },
  {
    key: 'discord',
    aliases: ['discord', 'discord.com', 'discord.gg'],
    domain: 'discord.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#5865F2" />
        <path
          d="M16.9 7.8a11.4 11.4 0 0 0-2.8-.9c-.1.2-.3.5-.4.7a10.6 10.6 0 0 0-3.4 0c-.1-.2-.3-.5-.4-.7a11.4 11.4 0 0 0-2.8.9C5.3 10.5 4.8 13.1 5 15.7a11.5 11.5 0 0 0 3.5 1.8c.3-.4.5-.8.7-1.3-.4-.1-.8-.3-1.1-.5.1-.1.2-.1.3-.2 2.2 1 4.6 1 6.8 0 .1.1.2.1.3.2-.4.2-.8.4-1.1.5.2.5.4.9.7 1.3a11.5 11.5 0 0 0 3.5-1.8c.3-3-.5-5.6-1.7-7.9ZM9.7 14.1c-.7 0-1.2-.6-1.2-1.4s.5-1.4 1.2-1.4c.7 0 1.3.6 1.2 1.4 0 .8-.5 1.4-1.2 1.4Zm4.6 0c-.7 0-1.2-.6-1.2-1.4s.5-1.4 1.2-1.4c.7 0 1.3.6 1.2 1.4 0 .8-.5 1.4-1.2 1.4Z"
          fill="#FFFFFF"
        />
      </svg>
    ),
  },
  {
    key: 'x',
    aliases: ['x', 'twitter', 'x.com', 'twitter.com'],
    domain: 'x.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#0F1419" />
        <path
          d="M13.3 10.9L18 5.5h-1.2l-4 4.7-3.2-4.7H5.8l4.9 7.1-4.9 5.9H7l4.2-5 3.4 5h3.8l-5.1-7.6Zm-1.6 1.8-.5-.7L7.4 6.5h1.8l3.1 4.4.5.7 4 5.7h-1.8l-3.3-4.6Z"
          fill="#FFFFFF"
        />
      </svg>
    ),
  },
  {
    key: 'perplexity',
    aliases: ['perplexity', 'perplexity.ai', 'pplx'],
    domain: 'perplexity.ai',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#1FB8CD" />
        <path
          d="M12 5v14M7 7.5l5 3.5 5-3.5M7 7.5V13h10V7.5M8.5 13v4.5l3.5-2.5 3.5 2.5V13"
          stroke="#FFFFFF"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    key: 'deepseek',
    aliases: ['deepseek', 'deepseek.com'],
    domain: 'deepseek.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#4D6BFE" />
        <path
          d="M6.5 13.5c0-3.2 2.7-5.5 6.2-5.5 2.5 0 4.5 1.2 5.3 3.2-1.1-.3-2.1-.1-2.8.6 1 .5 1.6 1.5 1.6 2.7 0 1.8-1.8 3-4.5 3-3.4 0-5.8-1.6-5.8-4Z"
          fill="#FFFFFF"
        />
        <circle cx="11.2" cy="11.8" r="1" fill="#4D6BFE" />
      </svg>
    ),
  },
  {
    key: 'midjourney',
    aliases: ['midjourney', 'mj', 'midjourney.com'],
    domain: 'midjourney.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#1E293B" />
        <path
          d="M7 16.5c2.2-2.6 2.8-6.4 2.4-9.5 2.6 1.8 4.4 5.2 4.6 9.5M12.5 16.5c1.5-2.1 2-5.1 1.7-7.7 1.8 1.5 3.1 4.2 3.3 7.7M5.5 17.5h13"
          stroke="#F8FAFC"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    key: 'grok',
    aliases: ['grok', 'xai', 'grok.com', 'x.ai'],
    domain: 'grok.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#111827" />
        <circle cx="12" cy="12" r="5.5" stroke="#FFFFFF" strokeWidth="1.8" />
        <path d="M7.5 16.5L17.2 6.8" stroke="#FFFFFF" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'notion',
    aliases: ['notion', 'notion.so', 'notion.site'],
    domain: 'notion.so',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#FFFFFF" stroke="#E2E8F0" />
        <path
          d="M7.5 16.8V7.8L10 7.4l4.5 6.4V7.6l2-.2v9.2l-2.3.3-4.7-6.6v6.5h-2Z"
          fill="#111827"
        />
      </svg>
    ),
  },
  {
    key: 'figma',
    aliases: ['figma', 'figma.com'],
    domain: 'figma.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#1E1E1E" />
        <path d="M9.5 19a2.5 2.5 0 0 0 2.5-2.5V14H9.5a2.5 2.5 0 0 0 0 5Z" fill="#0ACF83" />
        <path d="M7 11.5A2.5 2.5 0 0 1 9.5 9H12v5H9.5A2.5 2.5 0 0 1 7 11.5Z" fill="#A259FF" />
        <path d="M7 6.5A2.5 2.5 0 0 1 9.5 4H12v5H9.5A2.5 2.5 0 0 1 7 6.5Z" fill="#F24E1E" />
        <path d="M12 4h2.5a2.5 2.5 0 0 1 0 5H12V4Z" fill="#FF7262" />
        <circle cx="14.5" cy="11.5" r="2.5" fill="#1ABCFE" />
      </svg>
    ),
  },
  {
    key: 'vercel',
    aliases: ['vercel', 'vercel.com'],
    domain: 'vercel.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#000000" />
        <polygon points="12,6 18.5,17.2 5.5,17.2" fill="#FFFFFF" />
      </svg>
    ),
  },
  {
    key: 'cloudflare',
    aliases: ['cloudflare', 'cf', 'cloudflare.com'],
    domain: 'cloudflare.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#FFF3E8" />
        <path
          d="M16.5 15.8H7.2a2.7 2.7 0 0 1-.4-5.4A4.2 4.2 0 0 1 15 9.2a3 3 0 0 1 1.5 6.6Z"
          fill="#F38020"
        />
      </svg>
    ),
  },
  {
    key: 'telegram',
    aliases: ['telegram', 'tg', 'telegram.org', 't.me'],
    domain: 'telegram.org',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#26A5E4" />
        <path
          d="M17.8 6.8L5.6 11.5c-.6.2-.6 1 0 1.2l3 .9 1.1 3.5c.2.5.8.6 1.2.2l1.7-1.6 3.1 2.3c.5.4 1.2.1 1.3-.5l1.8-9.7c.1-.7-.4-1.2-1-1Z"
          fill="#FFFFFF"
        />
      </svg>
    ),
  },
  {
    key: 'youtube',
    aliases: ['youtube', 'yt', 'youtube.com'],
    domain: 'youtube.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#FF0000" />
        <polygon points="10,8.2 16.5,12 10,15.8" fill="#FFFFFF" />
      </svg>
    ),
  },
  {
    key: 'google',
    aliases: ['google', 'google.com', 'googlecloud', 'gcp'],
    domain: 'google.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#FFFFFF" stroke="#E2E8F0" />
        <path d="M18.2 12.2c0-.5 0-.9-.1-1.3H12v2.5h3.5a3 3 0 0 1-1.3 2v1.6h2.1c1.2-1.1 1.9-2.8 1.9-4.8Z" fill="#4285F4" />
        <path d="M12 18.5c1.7 0 3.2-.6 4.3-1.5l-2.1-1.6c-.6.4-1.3.6-2.2.6-1.7 0-3.1-1.1-3.6-2.7H6.2V15a6.5 6.5 0 0 0 5.8 3.5Z" fill="#34A853" />
        <path d="M8.4 13.3a3.9 3.9 0 0 1 0-2.6V9H6.2a6.5 6.5 0 0 0 0 6l2.2-1.7Z" fill="#FBBC05" />
        <path d="M12 8c.9 0 1.8.3 2.5 1l1.8-1.8A6.5 6.5 0 0 0 6.2 9l2.2 1.7C8.9 9.1 10.3 8 12 8Z" fill="#EA4335" />
      </svg>
    ),
  },
  {
    key: 'apple',
    aliases: ['apple', 'icloud', 'apple.com', 'appleid'],
    domain: 'apple.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#1D1D1F" />
        <path
          d="M14.7 6.2c.5-.6.9-1.4.8-2.2-.8.1-1.7.5-2.2 1.2-.5.6-.9 1.4-.8 2.2.9.1 1.7-.4 2.2-1.2Zm1.7 7.1c0-1.6 1.3-2.4 1.4-2.4-.8-1.1-2-1.3-2.4-1.3-1-.1-2 .6-2.5.6s-1.3-.6-2.2-.6c-1.1 0-2.2.7-2.8 1.7-1.2 2.1-.3 5.2.8 6.9.6.8 1.2 1.7 2.1 1.7.8 0 1.2-.5 2.2-.5s1.3.5 2.2.5c.9 0 1.5-.8 2-1.6.6-.9.9-1.8.9-1.8 0 0-1.7-.7-1.7-3.2Z"
          fill="#FFFFFF"
        />
      </svg>
    ),
  },
  {
    key: 'microsoft',
    aliases: ['microsoft', 'ms', 'azure', 'outlook', 'microsoft.com'],
    domain: 'microsoft.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#F8FAFC" stroke="#E2E8F0" />
        <rect x="5.5" y="5.5" width="5.8" height="5.8" rx="0.8" fill="#F25022" />
        <rect x="12.7" y="5.5" width="5.8" height="5.8" rx="0.8" fill="#7FBA00" />
        <rect x="5.5" y="12.7" width="5.8" height="5.8" rx="0.8" fill="#00A4EF" />
        <rect x="12.7" y="12.7" width="5.8" height="5.8" rx="0.8" fill="#FFB900" />
      </svg>
    ),
  },
  {
    key: 'aws',
    aliases: ['aws', 'amazon', 'aws.amazon.com', 'amazon.com'],
    domain: 'aws.amazon.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#232F3E" />
        <path
          d="M6.5 14.2c3.2 2.2 7.8 2.2 11 0M15.8 13.6l2 .3-.5 2"
          stroke="#FF9900"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text
          x="12"
          y="11.5"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="6.5"
          fontWeight="700"
          fontFamily="sans-serif"
        >
          AWS
        </text>
      </svg>
    ),
  },
  {
    key: 'spotify',
    aliases: ['spotify', 'spotify.com'],
    domain: 'spotify.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#1DB954" />
        <path d="M6.8 9.6c3.5-1 7.6-.8 10.7.8" stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M7.6 12.6c2.9-.8 6.2-.6 8.8.7" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M8.5 15.5c2.2-.5 4.8-.4 6.8.6" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'netflix',
    aliases: ['netflix', 'netflix.com'],
    domain: 'netflix.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#141414" />
        <path d="M8 18V6h2.4l3.2 8.2V6H16v12h-2.3L10.4 9.7V18H8Z" fill="#E50914" />
      </svg>
    ),
  },
  {
    key: 'reddit',
    aliases: ['reddit', 'reddit.com'],
    domain: 'reddit.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#FF4500" />
        <circle cx="12" cy="13.5" r="4.8" fill="#FFFFFF" />
        <circle cx="10.2" cy="13.2" r="0.85" fill="#FF4500" />
        <circle cx="13.8" cy="13.2" r="0.85" fill="#FF4500" />
        <path d="M12 8.7l1.2-2.6 2.5.6" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="16.4" cy="6.8" r="1" fill="#FFFFFF" />
      </svg>
    ),
  },
  {
    key: 'stripe',
    aliases: ['stripe', 'stripe.com'],
    domain: 'stripe.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#635BFF" />
        <path
          d="M11.6 10c0-.6.5-.9 1.3-.9 1.1 0 2.4.4 3.4 1V7.2c-1.1-.4-2.2-.7-3.4-.7-2.8 0-4.6 1.5-4.6 3.8 0 3.7 5.1 3.1 5.1 4.7 0 .7-.6 1-1.5 1-1.3 0-2.8-.5-4-1.2v2.9c1.3.6 2.7.8 4 .8 2.9 0 4.8-1.4 4.8-3.8 0-4-5.1-3.3-5.1-4.7Z"
          fill="#FFFFFF"
        />
      </svg>
    ),
  },
  {
    key: 'paypal',
    aliases: ['paypal', 'paypal.com'],
    domain: 'paypal.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#003087" />
        <path
          d="M9.4 6.5h4.1c2.1 0 3.4 1 3.1 3-.3 2.1-1.9 3.3-4.1 3.3h-1.6l-.8 4.7H7.6l1.8-11Z"
          fill="#FFFFFF"
        />
        <path
          d="M11.3 9.3h3.2c1.6 0 2.6.8 2.4 2.4-.3 1.7-1.5 2.7-3.3 2.7h-1.2l-.6 3.3h-2l1.5-8.4Z"
          fill="#009CDE"
        />
      </svg>
    ),
  },
  {
    key: 'slack',
    aliases: ['slack', 'slack.com'],
    domain: 'slack.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#4A154B" />
        <rect x="6" y="10.2" width="5" height="2" rx="1" fill="#36C5F0" />
        <rect x="11.8" y="6" width="2" height="5" rx="1" fill="#2EB67D" />
        <rect x="13" y="11.8" width="5" height="2" rx="1" fill="#ECB22E" />
        <rect x="10.2" y="13" width="2" height="5" rx="1" fill="#E01E5A" />
      </svg>
    ),
  },
  {
    key: 'linear',
    aliases: ['linear', 'linear.app'],
    domain: 'linear.app',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#5E6AD2" />
        <circle cx="12" cy="12" r="6" stroke="#FFFFFF" strokeWidth="1.6" />
        <path d="M7.5 13.5l3 3M8.5 10l5.5 5.5" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'supabase',
    aliases: ['supabase', 'supabase.com'],
    domain: 'supabase.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#1C1C1C" />
        <path d="M13.2 5.2L6.8 13.4h5.3l-.9 5.4 6.4-8.2h-5.3l.9-5.4Z" fill="#3ECF8E" />
      </svg>
    ),
  },
  {
    key: 'gitlab',
    aliases: ['gitlab', 'gitlab.com'],
    domain: 'gitlab.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#1F1E24" />
        <path
          d="M12 18.2L5.5 13.4 7.5 7l2 5h5l2-5 2 6.4-6.5 4.8Z"
          fill="#FC6D26"
        />
      </svg>
    ),
  },
  {
    key: 'steam',
    aliases: ['steam', 'steampowered.com', 'store.steampowered.com'],
    domain: 'steampowered.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#1B2838" />
        <circle cx="14.6" cy="9.4" r="2.7" stroke="#FFFFFF" strokeWidth="1.6" />
        <circle cx="9.2" cy="14.8" r="2.1" stroke="#FFFFFF" strokeWidth="1.5" />
        <path d="M12.6 11.4L10.7 13.3M5 12.8l3.2 1.4" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'windsurf',
    aliases: ['windsurf', 'codeium', 'windsurf.com', 'codeium.com'],
    domain: 'windsurf.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#09B6A2" />
        <path
          d="M6.5 15.5c2.2-5 4.5-6.5 5.5-2.5 1 4 3.3 2.5 5.5-4.5"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    key: 'canva',
    aliases: ['canva', 'canva.com'],
    domain: 'canva.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#00C4CC" />
        <path
          d="M15.6 9.3a4.6 4.6 0 1 0 .2 5.2"
          stroke="#FFFFFF"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    key: 'docker',
    aliases: ['docker', 'docker.com', 'dockerhub'],
    domain: 'docker.com',
    render: (className) => (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <rect width="24" height="24" rx="6" fill="#2496ED" />
        <rect x="7" y="10.2" width="2.2" height="2" fill="#FFFFFF" />
        <rect x="9.7" y="10.2" width="2.2" height="2" fill="#FFFFFF" />
        <rect x="12.4" y="10.2" width="2.2" height="2" fill="#FFFFFF" />
        <rect x="9.7" y="7.8" width="2.2" height="2" fill="#FFFFFF" />
        <path d="M5.8 13.2h11.6c-.4 2.6-2.5 4.3-6 4.3-3.4 0-5.4-1.6-5.6-4.3Z" fill="#FFFFFF" />
      </svg>
    ),
  },
];

const FALLBACK_PALETTE = [
  { bg: '#E8F2FF', fg: '#0F52BA' },
  { bg: '#EFEAFD', fg: '#5637CF' },
  { bg: '#E6F7EE', fg: '#116B3B' },
  { bg: '#FEF3DF', fg: '#8A5000' },
  { bg: '#FDECEC', fg: '#B42318' },
  { bg: '#E6F7FA', fg: '#0E7490' },
] as const;

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/[\s_-]+/g, '');
}

function findBrand(name: string, domain?: string | null): BrandEntry | undefined {
  const candidates = [domain, name]
    .filter((item): item is string => Boolean(item && item.trim()))
    .map(normalizeKey);
  for (const candidate of candidates) {
    const exact = BRAND_ENTRIES.find((entry) =>
      entry.aliases.some((alias) => normalizeKey(alias) === candidate),
    );
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const partial = BRAND_ENTRIES.find((entry) =>
      entry.aliases.some(
        (alias) =>
          alias.length >= 3 &&
          (candidate.includes(normalizeKey(alias)) ||
            normalizeKey(alias).includes(candidate)),
      ),
    );
    if (partial) return partial;
  }
  return undefined;
}

export function inferDefaultDomain(name: string): string | null {
  return findBrand(name)?.domain ?? null;
}

function monogramText(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '?';
  const asciiWords = cleaned.match(/[A-Za-z0-9]+/g);
  if (asciiWords && asciiWords.length >= 2) {
    return (asciiWords[0][0] + asciiWords[1][0]).toUpperCase();
  }
  return cleaned.slice(0, 1).toUpperCase();
}

function paletteFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

const SIZE_CLASSES = {
  xs: 'size-3.5',
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-7',
} as const;

export function AppBrandIcon({
  name,
  domain,
  iconData,
  size = 'sm',
  className,
}: {
  name: string;
  domain?: string | null;
  iconData?: string | null;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}) {
  const sizeClass = SIZE_CLASSES[size];

  if (iconData && iconData.startsWith('data:image/')) {
    return (
      <img
        src={iconData}
        alt=""
        aria-hidden="true"
        data-slot="app-brand-icon"
        data-source="fetched"
        className={cn(
          sizeClass,
          'shrink-0 rounded-[4px] object-contain',
          className,
        )}
      />
    );
  }

  const brand = findBrand(name, domain);
  if (brand) {
    return (
      <span
        data-slot="app-brand-icon"
        data-source="builtin"
        data-brand={brand.key}
        className={cn('inline-flex shrink-0 items-center justify-center', className)}
      >
        {brand.render(cn(sizeClass, 'shrink-0'))}
      </span>
    );
  }

  const palette = paletteFor(name);
  return (
    <span
      aria-hidden="true"
      data-slot="app-brand-icon"
      data-source="monogram"
      style={{ backgroundColor: palette.bg, color: palette.fg }}
      className={cn(
        sizeClass,
        'inline-flex shrink-0 items-center justify-center rounded-[5px] text-[10px] leading-none font-bold select-none',
        size === 'lg' && 'rounded-lg text-xs',
        className,
      )}
    >
      {monogramText(name)}
    </span>
  );
}
