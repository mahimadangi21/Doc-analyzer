import React, { useEffect, useState } from "react";
import { api } from "../api";
import type { OpsQueueItem } from "../api";

interface Props {
  onSelectApplication: (id: number) => void;
  onRefreshBadge: () => void;
}

export const OpsQueue: React.FC<Props> = ({ onSelectApplication, onRefreshBadge }) => {
  const [items, setItems] = useState<OpsQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Resolution modal/state
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchQueue = () => {
    setLoading(true);
    api.getOpsQueue()
      .then((data) => {
        setItems(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load ops queue");
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchQueue();
  }, []);

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingId || !note.trim()) return;

    setSubmitting(true);
    try {
      await api.resolveOpsItem(resolvingId, note);
      setResolvingId(null);
      setNote("");
      fetchQueue();
      onRefreshBadge();
    } catch (err: any) {
      alert("Failed to resolve: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Helper to format relative time
  const getRelativeTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  if (loading) return <div className="loading">Loading ops queue...</div>;
  if (error) return <div className="error-message">Error: {error}</div>;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Human Ops Queue</h1>
        <p className="page-subtitle">Pending cases flagged for manual customer outreach & collection</p>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <h3>Queue is clear</h3>
          <p style={{ marginTop: "8px" }}>No applications currently require human intervention.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Loan Type</th>
                <th>Missing Documents</th>
                <th>Time Raised</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.ops_queue_id}>
                  <td>
                    <span 
                      style={{ fontWeight: 600, color: "var(--primary)", cursor: "pointer", textDecoration: "underline" }}
                      onClick={() => onSelectApplication(item.applicant_id)}
                    >
                      {item.full_name}
                    </span>
                    <div className="mono" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "2px" }}>
                      Applicant ID: #{item.applicant_id}
                    </div>
                  </td>
                  <td>{item.loan_type}</td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {item.missing_documents.map((doc) => (
                        <span key={doc} className="badge status-incomplete" style={{ fontSize: "0.7rem" }}>
                          {doc}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="mono">{getRelativeTime(item.raised_at)}</td>
                  <td>
                    <button 
                      className="btn btn-outline" 
                      style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                      onClick={() => setResolvingId(item.ops_queue_id)}
                    >
                      Resolve Task
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Resolve Modal Overlay */}
      {resolvingId && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000
        }}>
          <div className="section-card" style={{ width: "100%", maxWidth: "450px", margin: "20px" }}>
            <h2 className="section-title" style={{ marginTop: 0 }}>Resolve Ops Queue Task</h2>
            <form onSubmit={handleResolve}>
              <div className="form-group">
                <label className="form-label">Resolution Note</label>
                <textarea 
                  className="form-input" 
                  rows={4} 
                  required
                  placeholder="e.g. Contacted applicant. They will upload payslips tomorrow."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ resize: "vertical" }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
                <button type="button" className="btn btn-outline" onClick={() => { setResolvingId(null); setNote(""); }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? "Resolving..." : "Mark Resolved"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
