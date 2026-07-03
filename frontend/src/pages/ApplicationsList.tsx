import React, { useEffect, useState } from "react";
import { api } from "../api";
import type { ApplicationSummary } from "../api";

interface Props {
  onSelectApplication: (id: number) => void;
}

export const ApplicationsList: React.FC<Props> = ({ onSelectApplication }) => {
  const [apps, setApps] = useState<ApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getApplications()
      .then((data) => {
        setApps(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load applications");
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="loading">Loading applications...</div>;
  if (error) return <div className="error-message">Error: {error}</div>;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Applications</h1>
        <p className="page-subtitle">Internal credit check & loan pipeline queue</p>
      </div>

      <div className="table-container">
        <table className="ops-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Applicant</th>
              <th>Email</th>
              <th>Loan Type</th>
              <th>Status</th>
              <th>Missing Docs</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((app) => (
              <tr 
                key={app.applicant_id} 
                className="clickable"
                onClick={() => onSelectApplication(app.applicant_id)}
              >
                <td className="mono">#{app.applicant_id}</td>
                <td style={{ fontWeight: 600 }}>{app.full_name}</td>
                <td>{app.email}</td>
                <td>{app.loan_type}</td>
                <td>
                  <span className={`badge ${app.status === "DOCUMENTS_COMPLETE" ? "status-complete" : "status-incomplete"}`}>
                    {app.status}
                  </span>
                </td>
                <td className="mono">{app.missing_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
