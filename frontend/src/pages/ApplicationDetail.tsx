import React, { useEffect, useState } from "react";
import { api } from "../api";
import type { ApplicationDetail } from "../api";

interface Props {
  applicantId: number;
  onBack: () => void;
  onCheckSuccess?: () => void;
}

export const ApplicationDetailView: React.FC<Props> = ({ applicantId, onBack, onCheckSuccess }) => {
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Mock upload fields
  const [selectedDocType, setSelectedDocType] = useState("");
  const [mockFileUrl, setMockFileUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [checking, setChecking] = useState(false);

  const fetchDetail = () => {
    setLoading(true);
    api.getApplicationDetail(applicantId)
      .then((data) => {
        setDetail(data);
        if (data.checklist.length > 0) {
          // Default selection to the first missing document
          const missing = data.checklist.find(c => !c.uploaded);
          setSelectedDocType(missing ? missing.document_type : data.checklist[0].document_type);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load application detail");
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchDetail();
  }, [applicantId]);

  const handleMockUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDocType) return;
    
    setUploading(true);
    const url = mockFileUrl || `http://example.com/uploads/${applicantId}_${selectedDocType.toLowerCase()}.pdf`;
    try {
      await api.uploadDocument(applicantId, selectedDocType, url);
      setMockFileUrl("");
      fetchDetail();
    } catch (err: any) {
      alert("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleReCheck = async () => {
    setChecking(true);
    try {
      await api.checkDocuments(applicantId);
      fetchDetail();
      if (onCheckSuccess) onCheckSuccess();
    } catch (err: any) {
      alert("Check failed: " + err.message);
    } finally {
      setChecking(false);
    }
  };

  if (loading) return <div className="loading">Loading application detail...</div>;
  if (error || !detail) return <div className="error-message">Error: {error || "No data"}</div>;

  const isComplete = detail.status === "DOCUMENTS_COMPLETE";
  const isIncomplete = detail.status === "DOCUMENTS_INCOMPLETE";

  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <button className="btn btn-outline" onClick={onBack} style={{ marginBottom: "16px" }}>
            ← Back to Applications
          </button>
          <h1 className="page-title">{detail.applicant.full_name}</h1>
          <p className="page-subtitle">ID: #{detail.applicant.applicant_id} | {detail.loan_type}</p>
        </div>
        <div>
          <button className="btn btn-primary" onClick={handleReCheck} disabled={checking}>
            {checking ? "Checking..." : "Re-run Checks"}
          </button>
        </div>
      </div>

      {/* Pipeline Status Rail */}
      <div className="pipeline-rail">
        <div className="pipeline-step active">
          <span className="step-label">Stage 1</span>
          <span className="step-status">LOAN_RECEIVED</span>
        </div>
        <div className="pipeline-step active">
          <span className="step-label">Stage 2</span>
          <span className="step-status">CHECK_DOCUMENTS</span>
        </div>
        <div className="pipeline-step active">
          <span className="step-label">Current Status</span>
          <span className={`step-status badge ${isComplete ? "status-complete" : "status-incomplete"}`}>
            {detail.status}
          </span>
        </div>
      </div>

      <div className="detail-grid">
        {/* Left Side: Checklist and Upload */}
        <div>
          {/* Callout message */}
          {isComplete && (
            <div className="callout-box mint">
              <div className="callout-title">✓ Requirements Met</div>
              <div className="callout-desc">
                All required documents are present. The application is ready to transition to the downstream OCR and ingestion pipeline.
              </div>
            </div>
          )}
          
          {isIncomplete && (
            <div className="callout-box amber">
              <div className="callout-title">⚠ Human Review Pending</div>
              <div className="callout-desc">
                This application has missing documents. It has been routed to the human operations queue. 
                No automatic reminder or retry loop will be triggered. A recheck must be run manually after documents are uploaded.
              </div>
            </div>
          )}

          {/* Document Checklist */}
          <div className="section-card">
            <h2 className="section-title">Required Documents Checklist</h2>
            <div className="checklist-container">
              {detail.checklist.map((item) => (
                <div className="checklist-item" key={item.document_type}>
                  <div className="checklist-info">
                    <span className="checklist-name">{item.display_name}</span>
                    <span className="checklist-code">{item.document_type}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {item.uploaded ? (
                      <>
                        <a href={item.file_url || "#"} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: "0.8rem", color: "var(--primary)" }}>
                          View Document
                        </a>
                        <span className="badge status-complete">Received</span>
                      </>
                    ) : (
                      <span className="badge status-incomplete">Missing</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Upload Document Form */}
          <div className="section-card">
            <h2 className="section-title">Upload New Document</h2>
            <form onSubmit={handleMockUpload}>
              <div className="form-group">
                <label className="form-label">Document Type</label>
                <select 
                  className="form-input" 
                  value={selectedDocType}
                  onChange={(e) => setSelectedDocType(e.target.value)}
                >
                  {detail.checklist.map(c => (
                    <option key={c.document_type} value={c.document_type}>
                      {c.display_name} ({c.uploaded ? "Replace" : "Missing"})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">File URL (optional, defaults to mock link)</label>
                <input 
                  type="text" 
                  className="form-input mono" 
                  placeholder="e.g. http://store.com/document.pdf"
                  value={mockFileUrl}
                  onChange={(e) => setMockFileUrl(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={uploading}>
                {uploading ? "Uploading..." : "Mock Document Upload"}
              </button>
            </form>
          </div>
        </div>

        {/* Right Side: Applicant details & Status History */}
        <div>
          <div className="section-card">
            <h2 className="section-title">Applicant Details</h2>
            <div className="flex flex-col gap-16">
              <div>
                <span className="form-label" style={{ marginBottom: "2px" }}>Full Name</span>
                <div>{detail.applicant.full_name}</div>
              </div>
              <div>
                <span className="form-label" style={{ marginBottom: "2px" }}>Email</span>
                <div className="mono">{detail.applicant.email}</div>
              </div>
              <div>
                <span className="form-label" style={{ marginBottom: "2px" }}>Phone</span>
                <div className="mono">{detail.applicant.phone || "N/A"}</div>
              </div>
              <div>
                <span className="form-label" style={{ marginBottom: "2px" }}>Timeline</span>
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  Created: {new Date(detail.created_at).toLocaleString()}<br />
                  Updated: {new Date(detail.updated_at).toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          <div className="section-card">
            <h2 className="section-title">Status Audit History</h2>
            <div className="history-timeline">
              {detail.history.map((h, idx) => (
                <div className="history-item" key={idx}>
                  <div className="history-dot"></div>
                  <div className="history-time">{new Date(h.created_at).toLocaleString()}</div>
                  <div className="history-desc">
                    Transitioned from <span className="mono" style={{ color: "#fff" }}>{h.from_status || "INIT"}</span> to <span className="mono" style={{ color: "#fff" }}>{h.to_status}</span>
                  </div>
                  {h.reason && (
                    <div className="history-reason">Reason: Missing {h.reason}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
