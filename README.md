# Scholarly Ideas

A web application that helps Management researchers develop rigorous, genuine research puzzles grounded in real empirical anomalies.

## Overview

Good research starts with genuine puzzles—empirical patterns that contradict or cannot be explained by existing theory. This app combats common pitfalls in academic research ideation:

- "Literature has overlooked X"
- "Let's open the black box"
- Pure "gap-spotting"

Through a hybrid approach combining Socratic dialogue, diagnostic assessment, and generative suggestions, researchers leave with clearly articulated puzzles, journal-ready framings, and research direction clarity.

## Features

### Entry Modes
- **I have an idea**: Evaluate and refine research directions against puzzle-quality criteria
- **I have data**: Upload data files and discover patterns that could become research puzzles
- **I'm exploring**: Broad discovery for researchers without a specific direction yet

### Core Capabilities
- **Pseudo-puzzle detection**: Identifies weak research framings and guides toward genuine puzzles
- **Data analysis**: Statistical analysis with rigor warnings for quantitative data
- **Literature integration**: OpenAlex-powered search with quality journal filtering (UTD24, top disciplinary journals)
- **Output generation**: Puzzle statements, introduction drafts, and comprehensive research briefs

### Multi-Provider AI Support
Choose your preferred AI provider directly in the browser settings:
- **Anthropic Claude** (Claude Sonnet 4, Claude 3.5 Haiku)
- **OpenAI** (GPT-4o, GPT-4o Mini, GPT-4 Turbo)
- **Google Gemini** (Gemini 2.0 Flash, Gemini 1.5 Pro)
- **Ollama** (Local models - Llama 3.2, Mistral, etc.)
- **OpenAI-Compatible APIs** (Together, Groq, etc.)

### Data Privacy
- All data processed transiently—never stored on servers
- API keys stored only in your browser's localStorage
- Export/import sessions for your own records
- No user accounts or authentication required

## Technology Stack

### Frontend
- **Framework**: Next.js 14 with TypeScript
- **Styling**: Tailwind CSS
- **State**: React Context + useReducer
- **AI Integration**: Vercel AI SDK

### Backend
- **API Routes**: Next.js API routes (Node.js)
- **Analysis Service**: Python FastAPI microservice
- **Literature Search**: OpenAlex API

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3.10+ (for data analysis features)

### Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/matthewgrimes/scholarly-ideas.git
   cd scholarly-ideas
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

5. Click the **Settings** icon and configure your AI provider:
   - Select your provider (Anthropic, OpenAI, Google, etc.)
   - Enter your API key
   - Click "Test Connection" to verify

### Using Ollama (Free, Local AI)

For a completely free setup using local AI:

1. Install [Ollama](https://ollama.ai/):
   ```bash
   # macOS
   brew install ollama

   # Linux
   curl -fsSL https://ollama.ai/install.sh | sh
   ```

2. Pull a model:
   ```bash
   ollama pull llama3.2
   ```

3. Start Ollama:
   ```bash
   ollama serve
   ```

4. In Scholarly Ideas settings, select "Ollama (Local)" as your provider.

### Analysis Service (Optional)

For data analysis features (CSV, Excel upload):

```bash
cd analysis-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Environment Variables (Optional)

For self-hosted deployments, you can provide API keys via environment variables:

```bash
cp .env.example .env.local
```

Edit `.env.local`:
```env
# Optional: Server-side API keys (used if browser settings not configured)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=

# For data analysis service
PYTHON_ANALYSIS_SERVICE_URL=http://localhost:8000
```

## Project Structure

```
scholarly-ideas/
├── src/
│   ├── app/                 # Next.js app router
│   │   ├── api/            # API routes
│   │   ├── conversation/   # Chat interface
│   │   └── page.tsx        # Welcome screen
│   ├── components/         # React components
│   │   └── settings/       # AI provider settings
│   ├── context/            # React context providers
│   ├── lib/
│   │   └── ai/            # AI provider abstraction
│   └── types/              # TypeScript types
├── analysis-service/       # Python FastAPI service
└── public/                 # Static assets
```

## Supported File Formats

- **Quantitative**: CSV, Excel (.xlsx, .xls), Stata (.dta), SPSS (.sav), R (.rds, .rda)
- **Qualitative**: Text files (.txt)
- **Documents**: PDF (.pdf)
- **Size limit**: 10MB

## Development

### Running Tests

```bash
# Frontend tests
npm run test

# Python tests
cd analysis-service
pytest
```

### Building for Production

```bash
npm run build
npm start
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT License](LICENSE)

## Acknowledgments

- Research methodology framework inspired by Zuckerman's work on genuine puzzles
- Built with [Next.js](https://nextjs.org/), [Tailwind CSS](https://tailwindcss.com/), and [Vercel AI SDK](https://sdk.vercel.ai/)
