"""
Scholarly Ideas - Python Analysis Service

FastAPI microservice for statistical analysis, file processing,
and data analysis tasks that require Python's scientific libraries.
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Any
import pandas as pd
import numpy as np
from io import BytesIO
import json

app = FastAPI(
    title="Scholarly Ideas Analysis Service",
    description="Statistical analysis and file processing for research puzzle development",
    version="0.1.0",
)

# CORS middleware for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Response models
class VariableStats(BaseModel):
    name: str
    dtype: str
    count: int
    missing: int
    unique: Optional[int] = None
    mean: Optional[float] = None
    std: Optional[float] = None
    min: Optional[float] = None
    max: Optional[float] = None
    median: Optional[float] = None


class FileSummary(BaseModel):
    filename: str
    rows: int
    columns: int
    variables: list[VariableStats]
    file_type: str


class AnalysisResult(BaseModel):
    type: str
    summary: str
    details: dict[str, Any]
    rigor_warnings: list[dict[str, str]]


# Health check
@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "analysis"}


# File upload and summary
@app.post("/upload", response_model=FileSummary)
async def upload_file(file: UploadFile = File(...)):
    """
    Upload and summarize a data file.
    Supports: CSV, Excel, Stata, SPSS, R data files.
    """
    if file.size > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(
            status_code=413,
            detail="File size exceeds 10MB limit. Consider sampling or splitting your data.",
        )

    filename = file.filename or "uploaded_file"
    extension = filename.split(".")[-1].lower()
    content = await file.read()

    try:
        df = read_data_file(content, extension)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to parse file: {str(e)}. Please check the file format.",
        )

    # Generate variable summaries
    variables = []
    for col in df.columns:
        series = df[col]
        var_stats = VariableStats(
            name=str(col),
            dtype=str(series.dtype),
            count=int(series.count()),
            missing=int(series.isna().sum()),
        )

        if pd.api.types.is_numeric_dtype(series):
            var_stats.mean = float(series.mean()) if not series.isna().all() else None
            var_stats.std = float(series.std()) if not series.isna().all() else None
            var_stats.min = float(series.min()) if not series.isna().all() else None
            var_stats.max = float(series.max()) if not series.isna().all() else None
            var_stats.median = float(series.median()) if not series.isna().all() else None
        else:
            var_stats.unique = int(series.nunique())

        variables.append(var_stats)

    return FileSummary(
        filename=filename,
        rows=len(df),
        columns=len(df.columns),
        variables=variables,
        file_type=extension,
    )


def read_data_file(content: bytes, extension: str) -> pd.DataFrame:
    """Read a data file and return a pandas DataFrame."""
    buffer = BytesIO(content)

    if extension in ["csv"]:
        return pd.read_csv(buffer)
    elif extension in ["xlsx", "xls"]:
        return pd.read_excel(buffer)
    elif extension in ["dta"]:
        import pyreadstat
        df, meta = pyreadstat.read_dta(buffer)
        return df
    elif extension in ["sav"]:
        import pyreadstat
        df, meta = pyreadstat.read_sav(buffer)
        return df
    elif extension in ["rds"]:
        import rdata
        parsed = rdata.parser.parse_file(buffer)
        converted = rdata.conversion.convert(parsed)
        # rds files contain a single object
        if isinstance(converted, pd.DataFrame):
            return converted
        raise ValueError("RDS file does not contain a DataFrame")
    elif extension in ["rda", "rdata"]:
        import rdata
        parsed = rdata.parser.parse_file(buffer)
        converted = rdata.conversion.convert(parsed)
        # rda files contain a dict of objects
        if isinstance(converted, dict):
            for key, value in converted.items():
                if isinstance(value, pd.DataFrame):
                    return value
        raise ValueError("RDA file does not contain a DataFrame")
    else:
        raise ValueError(f"Unsupported file format: {extension}")


# Descriptive analysis
@app.post("/analyze/descriptive", response_model=AnalysisResult)
async def analyze_descriptive(file: UploadFile = File(...)):
    """Run descriptive statistics on uploaded data."""
    content = await file.read()
    extension = (file.filename or "").split(".")[-1].lower()

    try:
        df = read_data_file(content, extension)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Get numeric columns
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()

    if not numeric_cols:
        return AnalysisResult(
            type="descriptive",
            summary="No numeric variables found for descriptive analysis.",
            details={"categorical_columns": df.columns.tolist()},
            rigor_warnings=[],
        )

    # Calculate statistics
    stats = df[numeric_cols].describe().to_dict()

    # Check for potential issues
    warnings = []

    # Check for small sample size
    if len(df) < 30:
        warnings.append({
            "type": "sample_size",
            "message": f"Small sample size (n={len(df)}). Results may not be generalizable.",
            "severity": "high",
        })

    # Check for high missing data
    for col in numeric_cols:
        missing_pct = df[col].isna().sum() / len(df) * 100
        if missing_pct > 20:
            warnings.append({
                "type": "missing_data",
                "message": f"High missing data in '{col}' ({missing_pct:.1f}%). Consider implications for analysis.",
                "severity": "medium",
            })

    return AnalysisResult(
        type="descriptive",
        summary=f"Analyzed {len(numeric_cols)} numeric variables across {len(df)} observations.",
        details={"statistics": stats, "sample_size": len(df)},
        rigor_warnings=warnings,
    )


# Anomaly detection
@app.post("/analyze/anomaly", response_model=AnalysisResult)
async def analyze_anomalies(file: UploadFile = File(...)):
    """Detect statistical anomalies and outliers in the data."""
    content = await file.read()
    extension = (file.filename or "").split(".")[-1].lower()

    try:
        df = read_data_file(content, extension)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    anomalies = []
    warnings = []

    for col in numeric_cols:
        series = df[col].dropna()
        if len(series) < 10:
            continue

        # IQR-based outlier detection
        q1, q3 = series.quantile([0.25, 0.75])
        iqr = q3 - q1
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr

        outliers = series[(series < lower_bound) | (series > upper_bound)]
        if len(outliers) > 0:
            anomalies.append({
                "variable": col,
                "outlier_count": len(outliers),
                "outlier_percentage": len(outliers) / len(series) * 100,
                "lower_bound": float(lower_bound),
                "upper_bound": float(upper_bound),
            })

    # Add multiple testing warning if checking many variables
    if len(numeric_cols) > 5:
        warnings.append({
            "type": "multiple_testing",
            "message": f"Checking {len(numeric_cols)} variables increases chance of spurious findings. Consider theory-driven selection.",
            "severity": "medium",
        })

    if not anomalies:
        summary = "No statistical outliers detected. Data appears consistent with normal patterns."
    else:
        summary = f"Found potential outliers in {len(anomalies)} of {len(numeric_cols)} numeric variables."

    return AnalysisResult(
        type="anomaly",
        summary=summary,
        details={"anomalies": anomalies, "variables_checked": len(numeric_cols)},
        rigor_warnings=warnings,
    )


# Correlation analysis
@app.post("/analyze/correlation", response_model=AnalysisResult)
async def analyze_correlations(file: UploadFile = File(...)):
    """Analyze correlations between numeric variables."""
    content = await file.read()
    extension = (file.filename or "").split(".")[-1].lower()

    try:
        df = read_data_file(content, extension)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()

    if len(numeric_cols) < 2:
        return AnalysisResult(
            type="correlation",
            summary="Need at least 2 numeric variables for correlation analysis.",
            details={},
            rigor_warnings=[],
        )

    # Calculate correlation matrix
    corr_matrix = df[numeric_cols].corr()

    # Find strong correlations
    strong_correlations = []
    for i, col1 in enumerate(numeric_cols):
        for col2 in numeric_cols[i + 1:]:
            corr = corr_matrix.loc[col1, col2]
            if abs(corr) > 0.5 and not np.isnan(corr):
                strong_correlations.append({
                    "var1": col1,
                    "var2": col2,
                    "correlation": float(corr),
                })

    warnings = []

    # Multiple testing warning
    num_tests = len(numeric_cols) * (len(numeric_cols) - 1) / 2
    if num_tests > 10:
        warnings.append({
            "type": "multiple_testing",
            "message": f"Testing {int(num_tests)} correlations. Some may be significant by chance alone.",
            "severity": "high",
        })

    summary = f"Analyzed correlations among {len(numeric_cols)} variables. "
    if strong_correlations:
        summary += f"Found {len(strong_correlations)} strong relationships (|r| > 0.5)."
    else:
        summary += "No strong correlations (|r| > 0.5) detected."

    return AnalysisResult(
        type="correlation",
        summary=summary,
        details={
            "correlation_matrix": corr_matrix.to_dict(),
            "strong_correlations": sorted(
                strong_correlations, key=lambda x: abs(x["correlation"]), reverse=True
            ),
        },
        rigor_warnings=warnings,
    )


# Theme analysis for qualitative data
@app.post("/analyze/theme", response_model=AnalysisResult)
async def analyze_themes(file: UploadFile = File(...)):
    """Extract recurring themes from qualitative text data."""
    content = await file.read()

    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Unable to decode text file. Please ensure it's UTF-8 encoded.")

    # Simple theme extraction using word frequency analysis
    # In production, this could use NLP libraries like spaCy or NLTK
    import re
    from collections import Counter

    # Define common themes to look for in organizational research
    theme_patterns = {
        "communication": r"\b(communication|communicat\w*|messag\w*|email\w*|meeting\w*|inform\w*)\b",
        "leadership": r"\b(leader\w*|management|manager\w*|director\w*|executive\w*|decision\w*)\b",
        "trust": r"\b(trust\w*|distrust\w*|psycholog\w*\s*safety|safe\w*|vulnerab\w*)\b",
        "conflict": r"\b(conflict\w*|friction|tension\w*|disagree\w*|dispute\w*)\b",
        "teamwork": r"\b(team\w*|collaborat\w*|cooperat\w*|together\w*|group\w*)\b",
        "deadlines": r"\b(deadline\w*|timeline\w*|schedule\w*|deliver\w*|due\s*date\w*|miss\w*)\b",
        "roles": r"\b(role\w*|responsib\w*|accountab\w*|clarif\w*|unclear\w*)\b",
        "silos": r"\b(silo\w*|department\w*|cross.?functional\w*|coordinat\w*)\b",
        "culture": r"\b(cultur\w*|norm\w*|value\w*|climate\w*|environment\w*)\b",
        "performance": r"\b(perform\w*|productiv\w*|efficien\w*|effectiv\w*|outcome\w*)\b",
    }

    text_lower = text.lower()
    themes = []

    for theme_name, pattern in theme_patterns.items():
        matches = re.findall(pattern, text_lower)
        if matches:
            themes.append({
                "theme": theme_name,
                "frequency": len(matches),
                "examples": list(set(matches))[:5],  # Up to 5 unique examples
            })

    # Sort by frequency
    themes = sorted(themes, key=lambda x: x["frequency"], reverse=True)

    # Also extract the most common words for additional context
    words = re.findall(r"\b[a-z]{4,}\b", text_lower)
    # Filter out common stop words
    stop_words = {"that", "this", "with", "from", "have", "were", "been", "they", "their", "about", "would", "could", "should", "which", "there", "being", "because", "didn", "wasn", "doesn", "people"}
    words = [w for w in words if w not in stop_words]
    word_counts = Counter(words).most_common(20)

    warnings = []

    # Add warning about automated theme extraction
    warnings.append({
        "type": "methodology",
        "message": "Themes extracted using pattern matching. For rigorous analysis, consider manual coding with inter-rater reliability.",
        "severity": "medium",
    })

    # Count approximate entries/segments
    segments = text.split("\n\n")
    segments = [s for s in segments if s.strip()]

    if len(segments) < 5:
        warnings.append({
            "type": "sample_size",
            "message": f"Only {len(segments)} text segments found. Consider whether this represents adequate data saturation.",
            "severity": "medium",
        })

    if not themes:
        summary = "No common themes detected. The text may not contain organizational research-related content."
    else:
        top_themes = [t["theme"] for t in themes[:3]]
        summary = f"Identified {len(themes)} recurring themes across {len(segments)} text segments. Top themes: {', '.join(top_themes)}."

    return AnalysisResult(
        type="theme",
        summary=summary,
        details={
            "themes": themes,
            "common_words": [{"word": w, "count": c} for w, c in word_counts],
            "segment_count": len(segments),
        },
        rigor_warnings=warnings,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
