import sqlite3
import os
import json

DB_PATH = os.path.join(os.path.dirname(__file__), "loanops.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    # Return rows as dictionaries
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # Create tables
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS applicants (
        applicant_id   INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name      TEXT NOT NULL,
        email          TEXT NOT NULL,
        phone          TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS loan_types (
        loan_type_id   INTEGER PRIMARY KEY AUTOINCREMENT,
        code           TEXT NOT NULL UNIQUE,
        display_name   TEXT NOT NULL
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS required_documents (
        required_document_id INTEGER PRIMARY KEY AUTOINCREMENT,
        loan_type_id   INTEGER NOT NULL REFERENCES loan_types(loan_type_id),
        document_type  TEXT NOT NULL,
        display_name   TEXT NOT NULL,
        is_active      INTEGER NOT NULL DEFAULT 1,
        UNIQUE (loan_type_id, document_type)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS applications (
        applicant_id   INTEGER PRIMARY KEY REFERENCES applicants(applicant_id),
        loan_type_id   INTEGER NOT NULL REFERENCES loan_types(loan_type_id),
        status         TEXT NOT NULL DEFAULT 'LOAN_RECEIVED'
                       CHECK (status IN ('LOAN_RECEIVED','DOCUMENTS_COMPLETE','DOCUMENTS_INCOMPLETE','OCR_IN_PROGRESS','OCR_COMPLETE')),
        missing_documents TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS uploaded_documents (
        uploaded_document_id INTEGER PRIMARY KEY AUTOINCREMENT,
        applicant_id   INTEGER NOT NULL REFERENCES applicants(applicant_id),
        document_type  TEXT NOT NULL,
        file_url       TEXT NOT NULL,
        uploaded_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS status_history (
        status_history_id INTEGER PRIMARY KEY AUTOINCREMENT,
        applicant_id   INTEGER NOT NULL REFERENCES applicants(applicant_id),
        from_status    TEXT,
        to_status      TEXT NOT NULL,
        reason         TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS ops_queue (
        ops_queue_id      INTEGER PRIMARY KEY AUTOINCREMENT,
        applicant_id      INTEGER NOT NULL REFERENCES applicants(applicant_id),
        missing_documents TEXT NOT NULL,
        raised_at         TEXT NOT NULL DEFAULT (datetime('now')),
        assigned_to       TEXT,
        resolved_at       TEXT,
        resolution_note   TEXT
    );
    """)

    # Indices
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ops_queue_unresolved ON ops_queue(applicant_id) WHERE resolved_at IS NULL;")
    
    conn.commit()

    # Seed data if empty
    cursor.execute("SELECT COUNT(*) FROM loan_types")
    if cursor.fetchone()[0] == 0:
        # Seed loan types
        cursor.execute("INSERT INTO loan_types (code, display_name) VALUES ('PERSONAL', 'Personal loan');")
        cursor.execute("INSERT INTO loan_types (code, display_name) VALUES ('AUTO', 'Auto loan');")
        cursor.execute("INSERT INTO loan_types (code, display_name) VALUES ('HOME', 'Home loan');")
        
        # Seed required docs
        # Personal
        cursor.execute("INSERT INTO required_documents (loan_type_id, document_type, display_name) VALUES (1, 'ID_PROOF', 'Government ID');")
        cursor.execute("INSERT INTO required_documents (loan_type_id, document_type, display_name) VALUES (1, 'PAYSLIP_3M', 'Last 3 months payslips');")
        cursor.execute("INSERT INTO required_documents (loan_type_id, document_type, display_name) VALUES (1, 'BANK_STATEMENT_3M', 'Last 3 months bank statement');")
        
        # Auto
        cursor.execute("INSERT INTO required_documents (loan_type_id, document_type, display_name) VALUES (2, 'ID_PROOF', 'Government ID');")
        cursor.execute("INSERT INTO required_documents (loan_type_id, document_type, display_name) VALUES (2, 'PAYSLIP_3M', 'Last 3 months payslips');")
        cursor.execute("INSERT INTO required_documents (loan_type_id, document_type, display_name) VALUES (2, 'VEHICLE_QUOTE', 'Vehicle purchase quote');")

        # Home
        cursor.execute("INSERT INTO required_documents (loan_type_id, document_type, display_name) VALUES (3, 'ID_PROOF', 'Government ID');")
        cursor.execute("INSERT INTO required_documents (loan_type_id, document_type, display_name) VALUES (3, 'PAYSLIP_3M', 'Last 3 months payslips');")
        cursor.execute("INSERT INTO required_documents (loan_type_id, document_type, display_name) VALUES (3, 'BANK_STATEMENT_6M', 'Last 6 months bank statement');")
        cursor.execute("INSERT INTO required_documents (loan_type_id, document_type, display_name) VALUES (3, 'PROPERTY_VALUATION', 'Property valuation report');")
        
        conn.commit()

        # Seed mock applicants
        seeds = [
            ("Alice Smith", "alice@example.com", "555-0100", "PERSONAL", ["ID_PROOF", "PAYSLIP_3M", "BANK_STATEMENT_3M"]),
            ("Bob Jones", "bob@example.com", "555-0101", "PERSONAL", ["ID_PROOF", "BANK_STATEMENT_3M"]), # Missing PAYSLIP_3M
            ("Charlie Brown", "charlie@example.com", "555-0102", "AUTO", ["ID_PROOF", "PAYSLIP_3M", "VEHICLE_QUOTE"]),
            ("David Miller", "david@example.com", "555-0103", "AUTO", ["PAYSLIP_3M"]), # Missing ID_PROOF, VEHICLE_QUOTE
            ("Emma Watson", "emma@example.com", "555-0104", "HOME", ["ID_PROOF", "PAYSLIP_3M", "BANK_STATEMENT_6M", "PROPERTY_VALUATION"]),
            ("Frank Castillo", "frank@example.com", "555-0105", "HOME", ["ID_PROOF", "PAYSLIP_3M", "BANK_STATEMENT_6M"]) # Missing PROPERTY_VALUATION
        ]

        for name, email, phone, loan_code, docs in seeds:
            cursor.execute("INSERT INTO applicants (full_name, email, phone) VALUES (?, ?, ?);", (name, email, phone))
            applicant_id = cursor.lastrowid
            
            cursor.execute("SELECT loan_type_id FROM loan_types WHERE code = ?;", (loan_code,))
            loan_type_id = cursor.fetchone()["loan_type_id"]
            
            cursor.execute("INSERT INTO applications (applicant_id, loan_type_id, status) VALUES (?, ?, 'LOAN_RECEIVED');", (applicant_id, loan_type_id))
            
            # Insert status history for LOAN_RECEIVED
            cursor.execute("""
            INSERT INTO status_history (applicant_id, from_status, to_status, reason)
            VALUES (?, NULL, 'LOAN_RECEIVED', 'Application created');
            """, (applicant_id,))
            
            for doc in docs:
                cursor.execute("""
                INSERT INTO uploaded_documents (applicant_id, document_type, file_url)
                VALUES (?, ?, ?);
                """, (applicant_id, doc, f"http://example.com/uploads/{applicant_id}_{doc.lower()}.pdf"))
                
        conn.commit()

        # Run check logic on all applications to establish correct initial statuses
        cursor.execute("SELECT applicant_id FROM applicants;")
        applicant_ids = [row["applicant_id"] for row in cursor.fetchall()]
        conn.close()

        # Reimport inline to avoid circular issues
        from main_logic import check_required_documents_internal
        conn2 = get_db_connection()
        for aid in applicant_ids:
            check_required_documents_internal(conn2, aid)
        conn2.close()
    else:
        conn.close()

if __name__ == "__main__":
    init_db()
    print("Database initialized and seeded.")
