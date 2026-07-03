const API_BASE = "http://localhost:4000";

export interface RequiredDoc {
  document_type: string;
  display_name: string;
}

export interface LoanType {
  loan_type_id: number;
  code: string;
  display_name: string;
  required_docs?: RequiredDoc[];
}

export interface ApplicationRow {
  application_id: number;
  status: string;
  is_submitted: boolean;
  created_at: string;
  full_name: string;
  email: string;
  loan_type: string;
  loan_type_code: string;
}

export interface ChecklistItem {
  document_type: string;
  display_name: string;
  uploaded: boolean;
  file_name: string | null;
  file_url: string | null;
  uploaded_at: string | null;
}

export interface ApplicationDetail {
  application_id: number;
  loan_type: string;
  loan_type_code: string;
  status: string;
  is_submitted: boolean;
  checklist: ChecklistItem[];
}

export const api = {
  getLoanTypes: async (): Promise<LoanType[]> => {
    const res = await fetch(`${API_BASE}/loan-types`);
    if (!res.ok) throw new Error("Failed to fetch loan types");
    return res.json();
  },

  getApplications: async (): Promise<ApplicationRow[]> => {
    const res = await fetch(`${API_BASE}/applications`);
    if (!res.ok) throw new Error("Failed to fetch applications");
    return res.json();
  },

  getApplicationDetail: async (id: number): Promise<ApplicationDetail> => {
    const res = await fetch(`${API_BASE}/applications/${id}`);
    if (!res.ok) throw new Error(`Failed to fetch application detail for ${id}`);
    return res.json();
  },

  createApplication: async (payload: {
    full_name: string;
    email: string;
    loan_type: string;
  }): Promise<ApplicationRow> => {
    const res = await fetch(`${API_BASE}/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed to create application");
    return res.json();
  },

  uploadDocument: async (
    applicationId: number,
    documentType: string,
    file: File
  ): Promise<{ success: boolean; status: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("document_type", documentType);

    const res = await fetch(`${API_BASE}/applications/${applicationId}/documents`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error("Failed to upload document");
    return res.json();
  },

  submitApplication: async (id: number): Promise<{ success: boolean; status: string; is_submitted: boolean }> => {
    const res = await fetch(`${API_BASE}/applications/${id}/submit`, {
      method: "POST"
    });
    if (!res.ok) throw new Error("Failed to submit application");
    return res.json();
  },

  updateRequirement: async (loanType: string, documentType: string, isRequired: boolean): Promise<{ success: boolean }> => {
    const res = await fetch(`${API_BASE}/loan-types/${loanType}/requirements`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_type: documentType, is_required: isRequired }),
    });
    if (!res.ok) throw new Error("Failed to update requirement");
    return res.json();
  }
};
