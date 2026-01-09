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
- **Literature integration**: Semantic Scholar-powered novelty checking and theory extraction
- **Output generation**: Puzzle statements, introduction drafts, and comprehensive research briefs

### Data Privacy
- All data processed transiently—never stored on servers
- Export/import sessions for your own records
- No user accounts or authentication required

## Technology Stack

### Frontend
- **Framework**: Next.js with TypeScript
- **Styling**: Tailwind CSS
- **Components**: shadcn/ui
- **State**: React Context + useReducer

### Backend
- **API Routes**: Next.js API routes (Node.js)
- **Analysis Service**: Python FastAPI microservice
- **LLM**: Claude API (Anthropic)
- **Literature**: Semantic Scholar API

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3.10+
- Claude API key ([get one here](https://console.anthropic.com/))

### Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/scholarly-ideas.git
   cd scholarly-ideas
   ```

2. Copy environment variables:
   ```bash
   cp .env.example .env.local
   ```

3. Add your API keys to `.env.local`:
   ```
   ANTHROPIC_API_KEY=your_key_here
   ```

4. Run the setup script:
   ```bash
   ./init.sh
   ```

5. Open [http://localhost:3000](http://localhost:3000)

### Manual Setup

If you prefer manual setup:

**Frontend (Next.js):**
```bash
npm install
npm run dev
```

**Analysis Service (Python):**
```bash
cd analysis-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
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
│   ├── context/            # React context providers
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Utility functions
│   └── types/              # TypeScript types
├── analysis-service/       # Python FastAPI service
├── docs/                   # Documentation
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

Contributions are welcome! Please read our contributing guidelines before submitting a pull request.

## License

[MIT License](LICENSE)

## Acknowledgments

- Research methodology framework inspired by Zuckerman's work on genuine puzzles
- Built with [Next.js](https://nextjs.org/), [Tailwind CSS](https://tailwindcss.com/), and [Claude](https://anthropic.com/)
