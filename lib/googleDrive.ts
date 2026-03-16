/**
 * Google Drive API utility functions
 * Handles OAuth authentication and file uploads to Google Drive
 */

export type GoogleDriveUploadResult = {
  success: boolean;
  fileId?: string;
  fileUrl?: string;
  uploadedAt?: string;
  error?: string;
};

export type GoogleDriveAuthResult = {
  success: boolean;
  authUrl?: string;
  error?: string;
};

/**
 * Get Google OAuth authorization URL
 * This should be called from the client to initiate OAuth flow
 */
export async function getGoogleAuthUrl(): Promise<GoogleDriveAuthResult> {
  try {
    const response = await fetch("/api/google-drive/auth", {
      method: "GET",
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: error.error || "Failed to get authorization URL",
      };
    }

    const data = await response.json();
    return {
      success: true,
      authUrl: data.authUrl,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get authorization URL",
    };
  }
}

/**
 * Upload file to Google Drive
 * @param fileBuffer - File buffer to upload
 * @param fileName - Name of the file
 * @param mimeType - MIME type of the file
 * @param jobId - Job ID for folder organization
 * @returns Upload result with file ID and URL
 */
export async function uploadToGoogleDrive(
  fileBuffer: Buffer | ArrayBuffer | Uint8Array,
  fileName: string,
  mimeType: string,
  jobId: string | number
): Promise<GoogleDriveUploadResult> {
  try {
    // Convert buffer to base64 for transmission
    const base64File =
      fileBuffer instanceof Buffer
        ? fileBuffer.toString("base64")
        : Buffer.from(fileBuffer).toString("base64");

    const response = await fetch("/api/google-drive/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fileData: base64File,
        fileName,
        mimeType,
        jobId: String(jobId),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: error.error || "Failed to upload to Google Drive",
      };
    }

    const data = await response.json();
    return {
      success: true,
      fileId: data.fileId,
      fileUrl: data.fileUrl,
      uploadedAt: data.uploadedAt,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to upload to Google Drive",
    };
  }
}

/**
 * Check if user is authenticated with Google Drive
 */
export async function checkGoogleDriveAuth(): Promise<boolean> {
  try {
    const response = await fetch("/api/google-drive/check-auth", {
      method: "GET",
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.authenticated === true;
  } catch (error) {
    return false;
  }
}
