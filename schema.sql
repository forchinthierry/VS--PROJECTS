CREATE TABLE loan_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  dob TEXT,
  residence TEXT,
  amount REAL,
  term TEXT,
  purpose TEXT,
  income REAL,
  employment TEXT,
  collateral TEXT,
  status TEXT DEFAULT 'New'
);

CREATE TABLE partnership_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  residence TEXT,
  occupation TEXT,
  shares INTEGER,
  total_contribution REAL,
  payout TEXT,
  payment_method TEXT,
  reason TEXT,
  next_of_kin TEXT,
  status TEXT DEFAULT 'New'
);
