import { NextRequest, NextResponse } from "next/server";

const PYTHON_SERVICE_URL = process.env.PYTHON_ANALYSIS_SERVICE_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    // Get the form data from the request
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "no_file", message: "No file provided" },
        { status: 400 }
      );
    }

    // Check file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        {
          error: "file_too_large",
          message: "File size exceeds 10MB limit. Consider sampling or splitting your data.",
        },
        { status: 413 }
      );
    }

    // Check file extension
    const filename = file.name;
    const extension = filename.split(".").pop()?.toLowerCase();
    const supportedFormats = ["csv", "xlsx", "xls", "dta", "sav", "rds", "rda", "rdata", "txt", "pdf"];

    if (!extension || !supportedFormats.includes(extension)) {
      return NextResponse.json(
        {
          error: "unsupported_format",
          message: `Unsupported file format. Supported formats: ${supportedFormats.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Forward to Python analysis service
    const pythonFormData = new FormData();
    pythonFormData.append("file", file);

    const response = await fetch(`${PYTHON_SERVICE_URL}/upload`, {
      method: "POST",
      body: pythonFormData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          error: "analysis_error",
          message: errorData.detail || "Failed to process file",
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      summary: data,
    });
  } catch (error) {
    console.error("Upload API error:", error);
    return NextResponse.json(
      {
        error: "upload_error",
        message: "Failed to upload file. Please try again.",
      },
      { status: 500 }
    );
  }
}
