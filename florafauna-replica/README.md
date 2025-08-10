# FloraFauna Studio (Replica)

An MVP infinite-canvas AI studio inspired by florafauna.ai. Built with Next.js, Tailwind, React Flow (XYFlow), and OpenAI.

## Setup

1. Create a `.env.local` file in the project root:

```
OPENAI_API_KEY=your_openai_key
```

2. Install dependencies and run dev:

```
npm install
npm run dev
```

Then open http://localhost:3000

## Features

- Infinite canvas with draggable nodes
- Text generation and image generation nodes
- Minimal sidebar to add nodes

## Notes

- This is an MVP. No persistence beyond page refresh. Add a database and auth to extend.
