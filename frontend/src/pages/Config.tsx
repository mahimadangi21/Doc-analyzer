import React, { useEffect, useState } from "react";
import { api } from "../api";
import type { RequiredDocumentConfig } from "../api";

export const ConfigView: React.FC = () => {
  const [config, setConfig] = useState<Record<string, RequiredDocumentConfig[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getRequiredDocumentsConfig()
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load config");
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="loading">Loading configuration...</div>;
  if (error) return <div className="error-message">Error: {error}</div>;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Document Configuration</h1>
        <p className="page-subtitle">Config-driven required documents per loan type</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "24px" }}>
        {Object.entries(config).map(([loanType, docs]) => (
          <div className="section-card" key={loanType}>
            <h2 className="section-title" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "12px", marginBottom: "16px" }}>
              {loanType}
            </h2>
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Document Type Code</th>
                  <th>Display Name</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => (
                  <tr key={doc.document_type}>
                    <td className="mono" style={{ fontWeight: 600 }}>{doc.document_type}</td>
                    <td>{doc.display_name}</td>
                    <td>
                      <span className={`badge ${doc.is_active ? "status-complete" : "status-incomplete"}`}>
                        {doc.is_active ? "ACTIVE" : "INACTIVE"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
};
