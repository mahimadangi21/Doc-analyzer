const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

// Multer storage config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Database initialization
const dbPath = path.join(__dirname, 'ultrabanker.db');
const db = new Database(dbPath);

db.exec(`
    CREATE TABLE IF NOT EXISTS loan_types (
        loan_type_id   INTEGER PRIMARY KEY AUTOINCREMENT,
        code           TEXT NOT NULL UNIQUE,
        display_name   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS required_documents (
        required_document_id INTEGER PRIMARY KEY AUTOINCREMENT,
        loan_type_id   INTEGER NOT NULL REFERENCES loan_types(loan_type_id),
        document_type  TEXT NOT NULL,
        display_name   TEXT NOT NULL,
        UNIQUE (loan_type_id, document_type)
    );

    CREATE TABLE IF NOT EXISTS applicants (
        applicant_id   INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name      TEXT NOT NULL,
        email          TEXT NOT NULL,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS applications (
        application_id INTEGER PRIMARY KEY AUTOINCREMENT,
        applicant_id   INTEGER NOT NULL REFERENCES applicants(applicant_id),
        loan_type_id   INTEGER NOT NULL REFERENCES loan_types(loan_type_id),
        status         TEXT NOT NULL DEFAULT 'LOAN_RECEIVED'
                       CHECK (status IN ('LOAN_RECEIVED','DOCUMENTS_COMPLETE','DOCUMENTS_INCOMPLETE')),
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS uploaded_documents (
        uploaded_document_id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL REFERENCES applications(application_id),
        document_type  TEXT NOT NULL,
        file_name      TEXT NOT NULL,
        file_url       TEXT NOT NULL,
        uploaded_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

// Seeding if database is empty
const seedDatabase = () => {
    const row = db.prepare('SELECT COUNT(*) as count FROM loan_types').get();
    if (row.count === 0) {
        // Seed Loan Types
        const insertLoan = db.prepare('INSERT INTO loan_types (code, display_name) VALUES (?, ?)');
        insertLoan.run('PERSONAL', 'Personal loan');
        insertLoan.run('AUTO', 'Auto loan');
        insertLoan.run('HOME', 'Home loan');
        insertLoan.run('LAP', 'Loan Against Property');

        // Seed Required Documents
        const insertDoc = db.prepare('INSERT INTO required_documents (loan_type_id, document_type, display_name) VALUES (?, ?, ?)');
        // Personal
        insertDoc.run(1, 'ID_PROOF', 'Government ID');
        insertDoc.run(1, 'PAYSLIP_3M', 'Last 3 months payslips');
        insertDoc.run(1, 'BANK_STATEMENT_3M', 'Last 3 months bank statement');
        // Auto
        insertDoc.run(2, 'ID_PROOF', 'Government ID');
        insertDoc.run(2, 'PAYSLIP_3M', 'Last 3 months payslips');
        insertDoc.run(2, 'VEHICLE_QUOTE', 'Vehicle purchase quote');
        // Home
        insertDoc.run(3, 'ID_PROOF', 'Government ID');
        insertDoc.run(3, 'PAYSLIP_3M', 'Last 3 months payslips');
        insertDoc.run(3, 'BANK_STATEMENT_6M', 'Last 6 months bank statement');
        insertDoc.run(3, 'PROPERTY_VALUATION', 'Property valuation report');

        // LAP (Loan Against Property) - ID 4
        insertDoc.run(4, 'PAN', 'PAN Card');
        insertDoc.run(4, 'AADHAAR', 'Aadhaar Card');
        insertDoc.run(4, 'PHOTO', 'Passport Size Photo');
        insertDoc.run(4, 'ADDR_PROOF', 'Address Proof');
        insertDoc.run(4, 'BANK_STMT', 'Bank Statement (6 months)');
        insertDoc.run(4, 'SALARY_SLIP', 'Salary Slip (3 months)');
        insertDoc.run(4, 'ITR', 'ITR (2 years)');
        insertDoc.run(4, 'PROPERTY_DOC', 'Property Documents');
        insertDoc.run(4, 'VALUATION_RPT', 'Valuation Report');

        // Seed 6 example applicants & applications with varying uploads
        const insertApplicant = db.prepare('INSERT INTO applicants (full_name, email) VALUES (?, ?)');
        const insertApplication = db.prepare('INSERT INTO applications (applicant_id, loan_type_id, status) VALUES (?, ?, ?)');
        const insertUploaded = db.prepare('INSERT INTO uploaded_documents (application_id, document_type, file_name, file_url) VALUES (?, ?, ?, ?)');

        // 1. Alice (PERSONAL) - Incomplete (missing Bank Statement)
        const app1 = insertApplicant.run('Alice Smith', 'alice@example.com');
        insertApplication.run(app1.lastInsertRowid, 1, 'DOCUMENTS_INCOMPLETE');
        insertUploaded.run(1, 'ID_PROOF', 'alice_id.pdf', 'http://localhost:4000/uploads/seeded_alice_id.pdf');
        insertUploaded.run(1, 'PAYSLIP_3M', 'alice_payslip.pdf', 'http://localhost:4000/uploads/seeded_alice_payslip.pdf');

        // 2. Bob (PERSONAL) - Complete
        const app2 = insertApplicant.run('Bob Jones', 'bob@example.com');
        insertApplication.run(app2.lastInsertRowid, 1, 'DOCUMENTS_COMPLETE');
        insertUploaded.run(2, 'ID_PROOF', 'bob_id.pdf', 'http://localhost:4000/uploads/seeded_bob_id.pdf');
        insertUploaded.run(2, 'PAYSLIP_3M', 'bob_payslip.pdf', 'http://localhost:4000/uploads/seeded_bob_payslip.pdf');
        insertUploaded.run(2, 'BANK_STATEMENT_3M', 'bob_bank.pdf', 'http://localhost:4000/uploads/seeded_bob_bank.pdf');

        // 3. Charlie (AUTO) - Incomplete (missing Payslip and Quote)
        const app3 = insertApplicant.run('Charlie Brown', 'charlie@example.com');
        insertApplication.run(app3.lastInsertRowid, 2, 'DOCUMENTS_INCOMPLETE');
        insertUploaded.run(3, 'ID_PROOF', 'charlie_id.pdf', 'http://localhost:4000/uploads/seeded_charlie_id.pdf');

        // 4. David (AUTO) - Complete
        const app4 = insertApplicant.run('David Miller', 'david@example.com');
        insertApplication.run(app4.lastInsertRowid, 2, 'DOCUMENTS_COMPLETE');
        insertUploaded.run(4, 'ID_PROOF', 'david_id.pdf', 'http://localhost:4000/uploads/seeded_david_id.pdf');
        insertUploaded.run(4, 'PAYSLIP_3M', 'david_payslips.pdf', 'http://localhost:4000/uploads/seeded_david_payslips.pdf');
        insertUploaded.run(4, 'VEHICLE_QUOTE', 'david_quote.pdf', 'http://localhost:4000/uploads/seeded_david_quote.pdf');

        // 5. Emma (HOME) - Incomplete (missing Property Valuation)
        const app5 = insertApplicant.run('Emma Watson', 'emma@example.com');
        insertApplication.run(app5.lastInsertRowid, 3, 'DOCUMENTS_INCOMPLETE');
        insertUploaded.run(5, 'ID_PROOF', 'emma_id.pdf', 'http://localhost:4000/uploads/seeded_emma_id.pdf');
        insertUploaded.run(5, 'PAYSLIP_3M', 'emma_payslips.pdf', 'http://localhost:4000/uploads/seeded_emma_payslips.pdf');
        insertUploaded.run(5, 'BANK_STATEMENT_6M', 'emma_bank.pdf', 'http://localhost:4000/uploads/seeded_emma_bank.pdf');

        // 6. Frank (HOME) - Complete
        const app6 = insertApplicant.run('Frank Castillo', 'frank@example.com');
        insertApplication.run(app6.lastInsertRowid, 3, 'DOCUMENTS_COMPLETE');
        insertUploaded.run(6, 'ID_PROOF', 'frank_id.pdf', 'http://localhost:4000/uploads/seeded_frank_id.pdf');
        insertUploaded.run(6, 'PAYSLIP_3M', 'frank_payslips.pdf', 'http://localhost:4000/uploads/seeded_frank_payslips.pdf');
        insertUploaded.run(6, 'BANK_STATEMENT_6M', 'frank_bank.pdf', 'http://localhost:4000/uploads/seeded_frank_bank.pdf');
        insertUploaded.run(6, 'PROPERTY_VALUATION', 'frank_property.pdf', 'http://localhost:4000/uploads/seeded_frank_property.pdf');
    } else {
        // DB exists, ensure LAP type is inserted
        const lapExists = db.prepare("SELECT COUNT(*) as count FROM loan_types WHERE code = 'LAP'").get();
        if (lapExists.count === 0) {
            const insertLoan = db.prepare('INSERT INTO loan_types (code, display_name) VALUES (?, ?)');
            const lapResult = insertLoan.run('LAP', 'Loan Against Property');
            const lapId = lapResult.lastInsertRowid;

            const insertDoc = db.prepare('INSERT INTO required_documents (loan_type_id, document_type, display_name) VALUES (?, ?, ?)');
            insertDoc.run(lapId, 'PAN', 'PAN Card');
            insertDoc.run(lapId, 'AADHAAR', 'Aadhaar Card');
            insertDoc.run(lapId, 'PHOTO', 'Passport Size Photo');
            insertDoc.run(lapId, 'ADDR_PROOF', 'Address Proof');
            insertDoc.run(lapId, 'BANK_STMT', 'Bank Statement (6 months)');
            insertDoc.run(lapId, 'SALARY_SLIP', 'Salary Slip (3 months)');
            insertDoc.run(lapId, 'ITR', 'ITR (2 years)');
            insertDoc.run(lapId, 'PROPERTY_DOC', 'Property Documents');
            insertDoc.run(lapId, 'VALUATION_RPT', 'Valuation Report');
        }
    }
};
seedDatabase();

// Recomputes application completeness status
const computeApplicationStatus = (applicationId) => {
    const app = db.prepare('SELECT loan_type_id FROM applications WHERE application_id = ?').get(applicationId);
    if (!app) return 'LOAN_RECEIVED';

    // Get required doc types
    const requiredRows = db.prepare('SELECT document_type FROM required_documents WHERE loan_type_id = ?').all(app.loan_type_id);
    const required = requiredRows.map(r => r.document_type);

    // Get uploaded doc types
    const uploadedRows = db.prepare('SELECT DISTINCT document_type FROM uploaded_documents WHERE application_id = ?').all(applicationId);
    const uploaded = uploadedRows.map(r => r.document_type);

    // Check completeness
    const missing = required.filter(doc => !uploaded.includes(doc));
    
    let status = 'LOAN_RECEIVED';
    if (required.length > 0) {
        status = missing.length === 0 ? 'DOCUMENTS_COMPLETE' : 'DOCUMENTS_INCOMPLETE';
    }

    db.prepare('UPDATE applications SET status = ? WHERE application_id = ?').run(status, applicationId);
    return status;
};

// Endpoints
app.get('/loan-types', (req, res) => {
    try {
        const rows = db.prepare('SELECT loan_type_id, code, display_name FROM loan_types').all();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/applications', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT 
                a.application_id,
                a.status,
                a.created_at,
                ap.full_name,
                ap.email,
                lt.display_name as loan_type,
                lt.code as loan_type_code
            FROM applications a
            JOIN applicants ap ON a.applicant_id = ap.applicant_id
            JOIN loan_types lt ON a.loan_type_id = lt.loan_type_id
            ORDER BY a.application_id DESC
        `).all();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/applications/:id', (req, res) => {
    const { id } = req.params;
    try {
        const app = db.prepare(`
            SELECT a.application_id, a.loan_type_id, a.status, lt.display_name as loan_type
            FROM applications a
            JOIN loan_types lt ON a.loan_type_id = lt.loan_type_id
            WHERE a.application_id = ?
        `).get(id);
        
        if (!app) {
            return res.status(404).json({ error: 'Application not found' });
        }

        // Get checklist
        const required = db.prepare('SELECT document_type, display_name FROM required_documents WHERE loan_type_id = ?').all(app.loan_type_id);
        const uploaded = db.prepare('SELECT document_type, file_name, file_url, uploaded_at FROM uploaded_documents WHERE application_id = ?').all(id);

        const checklist = required.map(reqDoc => {
            const upDoc = uploaded.find(u => u.document_type === reqDoc.document_type);
            return {
                document_type: reqDoc.document_type,
                display_name: reqDoc.display_name,
                uploaded: !!upDoc,
                file_name: upDoc ? upDoc.file_name : null,
                file_url: upDoc ? upDoc.file_url : null,
                uploaded_at: upDoc ? upDoc.uploaded_at : null
            };
        });

        res.json({
            application_id: app.application_id,
            loan_type: app.loan_type,
            status: app.status,
            checklist
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/applications', (req, res) => {
    let { full_name, email, loan_type_id, loan_type } = req.body;
    
    if (!loan_type_id && loan_type) {
        const row = db.prepare('SELECT loan_type_id FROM loan_types WHERE code = ?').get(loan_type);
        if (row) {
            loan_type_id = row.loan_type_id;
        }
    }

    if (!full_name || !email || !loan_type_id) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const insertApplicant = db.prepare('INSERT INTO applicants (full_name, email) VALUES (?, ?)');
        const insertApplication = db.prepare('INSERT INTO applications (applicant_id, loan_type_id, status) VALUES (?, ?, ?)');
        
        // Execute inside transaction
        const runTx = db.transaction(() => {
            const applicantResult = insertApplicant.run(full_name, email);
            const appResult = insertApplication.run(applicantResult.lastInsertRowid, loan_type_id, 'LOAN_RECEIVED');
            
            // Recompute initially
            computeApplicationStatus(appResult.lastInsertRowid);
            return appResult.lastInsertRowid;
        });

        const newAppId = runTx();
        
        const newApp = db.prepare(`
            SELECT 
                a.application_id,
                a.status,
                a.created_at,
                ap.full_name,
                ap.email,
                lt.display_name as loan_type,
                lt.code as loan_type_code
            FROM applications a
            JOIN applicants ap ON a.applicant_id = ap.applicant_id
            JOIN loan_types lt ON a.loan_type_id = lt.loan_type_id
            WHERE a.application_id = ?
        `).get(newAppId);

        res.status(201).json(newApp);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/applications/:id/documents', upload.single('file'), (req, res) => {
    const { id } = req.params;
    const { document_type } = req.body;
    
    if (!req.file || !document_type) {
        return res.status(400).json({ error: 'File and document_type are required' });
    }

    try {
        const file_url = `http://localhost:${PORT}/uploads/${req.file.filename}`;
        
        db.prepare(`
            INSERT INTO uploaded_documents (application_id, document_type, file_name, file_url)
            VALUES (?, ?, ?, ?)
        `).run(id, document_type, req.file.originalname, file_url);

        // Recompute status
        const status = computeApplicationStatus(id);

        res.json({ success: true, status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`UltraBanker backend running on port ${PORT}`);
});
