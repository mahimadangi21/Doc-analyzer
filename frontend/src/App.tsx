import React, { useState, useEffect, useRef } from 'react';
import { api } from './api';
import type { LoanType, ApplicationRow, ApplicationDetail } from './api';

export default function App() {
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [loanTypes, setLoanTypes] = useState<LoanType[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'completed' | 'ops' | 'config'>('all');

  // Filters State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLoanFilter, setSelectedLoanFilter] = useState("");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState("");

  // Slide-in Panel State
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [editingAppId, setEditingAppId] = useState<number | null>(null);

  // New Case Form State
  const [newApplicantName, setNewApplicantName] = useState("");
  const [newApplicantEmail, setNewApplicantEmail] = useState("");
  const [newLoanType, setNewLoanType] = useState<string>("");

  // Loaded Case Details for Checklist
  const [loadedDetail, setLoadedDetail] = useState<ApplicationDetail | null>(null);
  const [uploadProgressMap, setUploadProgressMap] = useState<Record<string, boolean>>({});

  // File Inputs Refs
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const fetchApplicationsList = () => {
    api.getApplications()
      .then(data => setApplications(data))
      .catch(err => console.error("Error fetching cases:", err));
  };

  useEffect(() => {
    Promise.all([
      api.getLoanTypes(),
      api.getApplications()
    ])
    .then(([types, apps]) => {
      setLoanTypes(types);
      if (types.length > 0) {
        setNewLoanType(types[0].code);
      }
      setApplications(apps);
      setLoading(false);
    })
    .catch(err => {
      console.error("Initialization error:", err);
      setLoading(false);
    });
  }, []);

  const [formErrors, setFormErrors] = useState<{name?: string, email?: string}>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOpenNewPanel = () => {
    setEditingAppId(null);
    setLoadedDetail(null);
    setNewApplicantName("");
    setNewApplicantEmail("");
    setFormErrors({});
    setIsSubmitting(false);
    if (loanTypes.length > 0) {
      setNewLoanType(loanTypes[0].code);
    }
    setIsPanelOpen(true);
  };

  const handleOpenEditPanel = async (appId: number) => {
    setEditingAppId(appId);
    setIsPanelOpen(true);
    try {
      const detail = await api.getApplicationDetail(appId);
      setLoadedDetail(detail);
    } catch (err: any) {
      alert("Failed to load details: " + err.message);
    }
  };

  const handleClosePanel = () => {
    setIsPanelOpen(false);
    setEditingAppId(null);
    setLoadedDetail(null);
  };

  const handleCreateApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    // Frontend Input Validation
    const errors: {name?: string, email?: string} = {};
    if (newApplicantName.trim().length < 2) {
      errors.name = "Applicant Name must be at least 2 characters";
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newApplicantEmail.trim())) {
      errors.email = "Please enter a valid email address";
    }
    
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setFormErrors({});
    setIsSubmitting(true);
    try {
      const newApp = await api.createApplication({
        full_name: newApplicantName.trim(),
        email: newApplicantEmail.trim(),
        loan_type: newLoanType
      });
      setApplications(prev => [newApp, ...prev]);
      
      setEditingAppId(newApp.application_id);
      const detail = await api.getApplicationDetail(newApp.application_id);
      setLoadedDetail(detail);
    } catch (err: any) {
      alert("Failed to create case: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileUpload = async (documentType: string, file: File) => {
    if (!editingAppId) return;

    // Frontend File Validation
    const allowedExtensions = ['pdf', 'jpg', 'jpeg', 'png'];
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    
    if (!fileExtension || !allowedExtensions.includes(fileExtension)) {
      alert("Unsupported file format. Only PDF, JPG, JPEG, and PNG formats are allowed");
      return;
    }

    const maxSizeBytes = 15 * 1024 * 1024; // 15MB limit
    if (file.size > maxSizeBytes) {
      alert("File size exceeds the limit of 15MB");
      return;
    }

    setUploadProgressMap(prev => ({ ...prev, [documentType]: true }));
    try {
      await api.uploadDocument(editingAppId, documentType, file);
      
      const detail = await api.getApplicationDetail(editingAppId);
      setLoadedDetail(detail);
      
      fetchApplicationsList();
    } catch (err: any) {
      alert("Upload failed: " + err.message);
    } finally {
      setUploadProgressMap(prev => ({ ...prev, [documentType]: false }));
    }
  };

  const handleSubmitApplication = async () => {
    if (!editingAppId) return;
    try {
      await api.submitApplication(editingAppId);
      const detail = await api.getApplicationDetail(editingAppId);
      setLoadedDetail(detail);
      fetchApplicationsList();
    } catch (err: any) {
      alert("Submission failed: " + err.message);
    }
  };

  const handleToggleRequirement = async (loanType: string, documentType: string, currentVal: boolean) => {
    try {
      await api.updateRequirement(loanType, documentType, !currentVal);
      const types = await api.getLoanTypes();
      setLoanTypes(types);
      fetchApplicationsList();
    } catch (err: any) {
      alert("Failed to toggle config: " + err.message);
    }
  };

  const activeLoanConfig = loanTypes.find(t => t.code === (loadedDetail ? 
    loadedDetail.loan_type_code : newLoanType
  ));

  // Client-side filtering
  const filteredApps = applications.filter(app => {
    const matchesSearch = app.full_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          app.application_id.toString().includes(searchQuery);
    const matchesLoan = selectedLoanFilter ? app.loan_type_code === selectedLoanFilter : true;
    
    // Status matching based on activeTab
    let matchesTabStatus = true;
    if (activeTab === 'pending') {
      matchesTabStatus = app.status === 'DOCUMENTS_INCOMPLETE' || app.status === 'LOAN_RECEIVED';
    } else if (activeTab === 'completed') {
      matchesTabStatus = app.status === 'DOCUMENTS_COMPLETE';
    } else if (activeTab === 'ops') {
      matchesTabStatus = app.status === 'DOCUMENTS_INCOMPLETE';
    }
    
    const matchesStatus = selectedStatusFilter ? app.status === selectedStatusFilter : true;
    return matchesSearch && matchesLoan && matchesStatus && matchesTabStatus;
  });

  return (
    <div className="app-container">
      {/* Top Bar */}
      <header className="top-bar">
        <div className="logo-section">
          <div className="logo-badge">U</div>
          <div className="logo-text-group">
            <span className="logo-title">UltraBanker</span>
            <span className="logo-subtitle">Case Management & Intake</span>
          </div>
        </div>
        <div className="top-bar-right">
          <button className="icon-button" title="Notifications">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6" /><path d="M9 17v1a3 3 0 0 0 6 0v-1" /></svg>
          </button>
          <div className="user-avatar">JD</div>
        </div>
      </header>

      {/* Main workspace */}
      <div className="workspace">
        {/* Left Sidebar */}
        <aside className="sidebar">
          <ul className="sidebar-menu">
            <li>
              <a className={`nav-item ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
                All Cases
              </a>
            </li>
            <li>
              <a className={`nav-item ${activeTab === 'pending' ? 'active' : ''}`} onClick={() => setActiveTab('pending')}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                Pending Cases
              </a>
            </li>
            <li>
              <a className={`nav-item ${activeTab === 'completed' ? 'active' : ''}`} onClick={() => setActiveTab('completed')}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                Completed Cases
              </a>
            </li>
            <li>
              <a className={`nav-item ${activeTab === 'ops' ? 'active' : ''}`} onClick={() => setActiveTab('ops')}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"/></svg>
                Human Ops Queue
              </a>
            </li>
            <li>
              <a className={`nav-item ${activeTab === 'config' ? 'active' : ''}`} onClick={() => setActiveTab('config')}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 17h6" /><path d="M9 12h6" /><path d="M9 7h6" /></svg>
                Document Configuration
              </a>
            </li>
          </ul>
        </aside>

        {/* Main Area */}
        <main className="main-content">
          {activeTab !== 'config' ? (
            <>
              <div className="content-header">
                <div className="header-title-group">
                  <h1 className="page-title">
                    {activeTab === 'all' && 'All Cases'}
                    {activeTab === 'pending' && 'Pending Cases'}
                    {activeTab === 'completed' && 'Completed Cases'}
                    {activeTab === 'ops' && 'Human Ops Queue'}
                  </h1>
                  <span className="page-subtitle">{filteredApps.length} cases found</span>
                </div>
                <button className="btn btn-primary" onClick={handleOpenNewPanel}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Create Case
                </button>
              </div>

              {/* Filter Bar */}
              <div className="filter-row">
                <input 
                  type="text" 
                  className="filter-input" 
                  placeholder="Search by ID or name..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                <select 
                  className="filter-select"
                  value={selectedLoanFilter}
                  onChange={e => setSelectedLoanFilter(e.target.value)}
                >
                  <option value="">All loan types</option>
                  {loanTypes.map(t => (
                    <option key={t.code} value={t.code}>{t.display_name}</option>
                  ))}
                </select>
                <select 
                  className="filter-select"
                  value={selectedStatusFilter}
                  onChange={e => setSelectedStatusFilter(e.target.value)}
                >
                  <option value="">All statuses</option>
                  <option value="DOCUMENTS_COMPLETE">Documents complete</option>
                  <option value="DOCUMENTS_INCOMPLETE">Needs documents</option>
                  <option value="LOAN_RECEIVED">Loan received</option>
                </select>
              </div>

              {/* Table */}
              {loading ? (
                <div>Loading cases...</div>
              ) : (
                <div className="table-card">
                  <table className="banker-table">
                    <thead>
                      <tr>
                        <th>Case ID</th>
                        <th>Applicant Name</th>
                        <th>Loan Type</th>
                        <th>Assigned User</th>
                        <th>Created Date</th>
                        <th>Status</th>
                        <th>Missing Documents</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredApps.map(app => (
                        <tr key={app.application_id} className="clickable" onClick={() => handleOpenEditPanel(app.application_id)}>
                          <td className="mono">#{app.application_id}</td>
                          <td style={{ fontWeight: 600 }}>{app.full_name}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{app.loan_type}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{app.email.includes('alice') ? 'Alice Officer' : 'System Agent'}</td>
                          <td style={{ color: 'var(--text-muted)' }}>
                            {new Date(app.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </td>
                          <td>
                            <span className={`status-pill ${app.status === 'DOCUMENTS_COMPLETE' ? 'complete' : 'incomplete'}`}>
                              {app.status === 'DOCUMENTS_COMPLETE' ? 'Completed' : 'Pending'}
                            </span>
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                            {app.missing_docs || 'None'}
                          </td>
                          <td>
                            <button className="kebab-button" onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEditPanel(app.application_id);
                            }}>⋮</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="content-header">
                <div className="header-title-group">
                  <h1 className="page-title">Document Configuration</h1>
                  <span className="page-subtitle">Manage required documents for each loan policy</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {loanTypes.map((type) => (
                  <div key={type.code} className="table-card" style={{ padding: '24px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                      {type.display_name} Policy
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {type.required_docs?.map((doc) => (
                        <div key={doc.document_type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '13px' }}>{doc.display_name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }} className="mono">{doc.document_type}</div>
                          </div>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                            <input 
                              type="checkbox" 
                              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                              checked={doc.is_required === 1}
                              onChange={() => handleToggleRequirement(type.code, doc.document_type, doc.is_required === 1)}
                            />
                            Required
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </main>
      </div>

      {/* Dimmed Backdrop */}
      <div className={`backdrop-overlay ${isPanelOpen ? 'open' : ''}`} onClick={handleClosePanel}></div>

      {/* Slide-in Panel */}
      <div className={`slide-in-panel ${isPanelOpen ? 'open' : ''}`}>
        <div className="panel-header">
          <h2 className="panel-title">{editingAppId ? "Case Details" : "New Case"}</h2>
          <button className="panel-close-btn" onClick={handleClosePanel}>×</button>
        </div>

        {loadedDetail?.is_submitted && (
          <div style={{
            backgroundColor: 'var(--mint-bg)',
            borderBottom: '1px solid var(--mint-border)',
            color: 'var(--mint)',
            padding: '12px 20px',
            fontSize: '12px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span style={{ fontSize: '14px' }}>✓</span> Case submitted. Document uploads are locked.
          </div>
        )}

        <div className="panel-body">
          {/* Section 1: Form details */}
          <div>
            <div className="panel-section-title">Applicant details</div>
            <form onSubmit={handleCreateApplication}>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input 
                  type="text" 
                  required
                  disabled={editingAppId !== null}
                  className={`form-input ${formErrors.name ? 'error' : ''}`}
                  style={formErrors.name ? { borderColor: 'red' } : {}}
                  value={newApplicantName}
                  onChange={e => {
                    setNewApplicantName(e.target.value);
                    if (e.target.value.trim().length >= 2) {
                      setFormErrors(prev => ({ ...prev, name: undefined }));
                    }
                  }}
                />
                {formErrors.name && <span style={{ color: 'red', fontSize: '11px', marginTop: '4px', display: 'block' }}>{formErrors.name}</span>}
              </div>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input 
                  type="email" 
                  required
                  disabled={editingAppId !== null}
                  className={`form-input ${formErrors.email ? 'error' : ''}`}
                  style={formErrors.email ? { borderColor: 'red' } : {}}
                  value={newApplicantEmail}
                  onChange={e => {
                    setNewApplicantEmail(e.target.value);
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (emailRegex.test(e.target.value.trim())) {
                      setFormErrors(prev => ({ ...prev, email: undefined }));
                    }
                  }}
                />
                {formErrors.email && <span style={{ color: 'red', fontSize: '11px', marginTop: '4px', display: 'block' }}>{formErrors.email}</span>}
              </div>
              <div className="form-group">
                <label className="form-label">Loan Type</label>
                <select 
                  className="form-input" 
                  required
                  disabled={editingAppId !== null}
                  value={loadedDetail ? loadedDetail.loan_type_code : newLoanType}
                  onChange={e => setNewLoanType(e.target.value)}
                >
                  {loanTypes.map(t => (
                    <option key={t.code} value={t.code}>{t.display_name}</option>
                  ))}
                </select>
              </div>

              {!editingAppId && (
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  style={{ width: '100%', marginTop: '10px' }}
                  disabled={isSubmitting || newApplicantName.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newApplicantEmail.trim())}
                >
                  {isSubmitting ? "Creating..." : "Create Case"}
                </button>
              )}
            </form>
          </div>

          {/* Section 2: Required Documents Upload Cards */}
          {editingAppId && loadedDetail && (
            <div>
              <div className="panel-section-title">
                Required Documents ({loadedDetail.checklist.length})
              </div>
              
              {loadedDetail.checklist.map((item) => {
                const isUploading = uploadProgressMap[item.document_type];
                
                return (
                  <div className="upload-card" key={item.document_type}>
                    <div className="upload-card-header">{item.display_name}</div>
                    
                    {item.uploaded ? (
                      <div className="upload-card-success">
                        <div className="upload-success-left">
                          <span className="checkmark-icon">✓</span>
                          <a href={item.file_url || "#"} target="_blank" rel="noreferrer" className="uploaded-filename" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>
                            {item.file_name}
                          </a>
                        </div>
                        {!loadedDetail.is_submitted && (
                          <button 
                            className="replace-link"
                            onClick={() => fileInputRefs.current[item.document_type]?.click()}
                          >
                            Replace
                          </button>
                        )}
                      </div>
                    ) : (
                      <div 
                        className={`upload-card-dropzone ${loadedDetail.is_submitted ? 'disabled' : ''}`}
                        style={loadedDetail.is_submitted ? { cursor: 'not-allowed', opacity: 0.6 } : {}}
                        onClick={() => !loadedDetail.is_submitted && fileInputRefs.current[item.document_type]?.click()}
                      >
                        <svg className="dropzone-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                        <span className="dropzone-text">
                          {loadedDetail.is_submitted ? "Not uploaded" : (isUploading ? "Uploading..." : "Click to upload document")}
                        </span>
                        {!loadedDetail.is_submitted && <span className="dropzone-subtext">PDF, JPG, PNG</span>}
                      </div>
                    )}

                    {/* Hidden Native File Input */}
                    <input 
                      type="file" 
                      style={{ display: 'none' }}
                      ref={el => { fileInputRefs.current[item.document_type] = el; }}
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleFileUpload(item.document_type, e.target.files[0]);
                        }
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="panel-footer">
          {editingAppId && loadedDetail && !loadedDetail.is_submitted && (
            <button className="btn btn-primary" onClick={handleSubmitApplication}>
              Submit Case
            </button>
          )}
          <button className="btn btn-outline" onClick={handleClosePanel}>Close</button>
        </div>
      </div>
    </div>
  );
}
