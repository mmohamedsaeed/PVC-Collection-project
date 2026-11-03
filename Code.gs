/*************************************************
 * PVC COLLECTION
 * Secure Customer Search Portal
 *
 * Backend:
 * - PVC Collection spreadsheet = system database
 * - PVC DB / Total DB = private customer database
 *
 * IMPORTANT:
 * Never share this Apps Script project or either
 * spreadsheet with collection employees.
 *************************************************/

const APP = {
  NAME: 'PVC Collection',

  SHEETS: {
    USERS: 'Users',
    SEARCH_LOGS: 'SearchLogs',
    ADMIN_LOGS: 'AdminLogs',
    SETTINGS: 'Settings',
    PHONE_INDEX: 'PhoneIndex',
    PHONE_BUCKETS: 'PhoneBuckets',
    ACTIVITY_LOG: 'ActivityLog'
  },

  USER_ROLE: {
    USER: 'USER',
    ADMIN: 'ADMIN'
  },

  USER_STATUS: {
    PENDING: 'PENDING',
    ACTIVE: 'ACTIVE',
    REJECTED: 'REJECTED',
    DISABLED: 'DISABLED'
  },

  SECURITY: {
    PASSWORD_ITERATIONS: 12000,
    VERIFICATION_MINUTES: 30,
    SESSION_MINUTES: 60,
    MAX_SEARCH_RESULTS: 20,
    MIN_PHONE_DIGITS: 5,
    MIN_NAME_LENGTH: 4,
    MIN_EMAIL_LENGTH: 5,
    LOGIN_RATE_LIMIT: 10,
    LOGIN_RATE_WINDOW_SECONDS: 300,
    SIGNUP_RATE_LIMIT: 5,
    SIGNUP_RATE_WINDOW_SECONDS: 600,
    SEARCH_RATE_LIMIT: 60,
    SEARCH_RATE_WINDOW_SECONDS: 60,
    RESET_RATE_LIMIT: 5,
    RESET_RATE_WINDOW_SECONDS: 600,
    RESET_MINUTES: 30
  }
};

/* =================================================
 * WEB APP ENTRY
 * ================================================= */

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';

  if (action === 'verify') {
    return handleEmailVerification_(e);
  }

  if (action === 'reset') {
    return buildResetPage_(e && e.parameter ? String(e.parameter.token || '') : '');
  }

  if (action === 'admin') {
    const adminTemplate = HtmlService.createTemplateFromFile('Admin');
    adminTemplate.WEB_APP_URL = getRequiredProperty_('WEB_APP_URL');
    return adminTemplate.evaluate().setTitle('PVC Collection - Admin');
  }

  const t = HtmlService.createTemplateFromFile('Index');
  t.WEB_APP_URL = getRequiredProperty_('WEB_APP_URL');
  return t.evaluate().setTitle(APP.NAME);
}

/* =================================================
 * REQUIRED SCRIPT PROPERTIES
 * ================================================= */

function getRequiredProperty_(name) {
  const value = PropertiesService
    .getScriptProperties()
    .getProperty(name);

  if (!value) {
    throw new Error('Missing required Script Property: ' + name);
  }

  return value;
}

/* =================================================
 * NORMALIZATION
 * ================================================= */

function normalizeText_(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeEmail_(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function normalizeBoolean_(value) {
  if (value === true) return true;
  if (value === false) return false;

  const normalized = String(value == null ? '' : value)
    .trim()
    .toLowerCase();

  return normalized === 'true' ||
         normalized === '1' ||
         normalized === 'yes' ||
         normalized === 'y';
}

function normalizeDigits_(value) {
  return String(value || '')
    .replace(/[٠-٩]/g, function(d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); })
    .replace(/[۰-۹]/g, function(d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); });
}

function normalizePhone_(phone) {
  return normalizeDigits_(phone)
    .replace(/[^\d]/g, '');
}

function normalizePhoneMatchKeys_(phone) {
  const digits = normalizePhone_(phone);
  if (!digits) return [];

  const keys = [];
  function add(value) {
    if (value && keys.indexOf(value) === -1) keys.push(value);
  }

  let egyptianNsn = '';
  if (/^0020(10|11|12|15)\d{8}$/.test(digits)) {
    egyptianNsn = digits.substring(4);
  } else if (/^20(10|11|12|15)\d{8}$/.test(digits)) {
    egyptianNsn = digits.substring(2);
  } else if (/^0(10|11|12|15)\d{8}$/.test(digits)) {
    egyptianNsn = digits.substring(1);
  } else if (/^(10|11|12|15)\d{8}$/.test(digits)) {
    egyptianNsn = digits;
  }

  if (egyptianNsn) add(egyptianNsn);
  if (!egyptianNsn && /^00\d{6,}$/.test(digits)) add(digits.substring(2));
  add(digits);
  return keys;
}

function normalizePhoneList_(value) {
  return normalizeDigits_(value)
    .split(/[,،;|/\n\r]+|\s+[-–—]\s+/)
    .map(function(item) { return item.trim(); })
    .filter(Boolean)
    .map(function(item) { return item.replace(/[^\d+]/g, ''); })
    .map(function(item) { return item.replace(/(?!^)\+/g, ''); })
    .filter(Boolean);
}

function phoneSearchKeys_(value) {
  const keys = [];
  normalizePhoneList_(value).forEach(function(phone) {
    normalizePhoneMatchKeys_(phone).forEach(function(key) {
      if (keys.indexOf(key) === -1) keys.push(key);
    });
  });
  return keys;
}

function phoneQueryKeys_(value) {
  return normalizePhoneMatchKeys_(value);
}

function phonePartialSearchKeys_(value) {
  const digits = normalizePhone_(value);
  const keys = [];
  function add(key) {
    if (key && key.length >= 4 && keys.indexOf(key) === -1) {
      keys.push(key);
    }
  }

  add(digits);
  if (/^0(10|11|12|15)\d*$/.test(digits)) add(digits.substring(1));
  if (/^20(10|11|12|15)\d*$/.test(digits)) add(digits.substring(2));
  if (/^0020(10|11|12|15)\d*$/.test(digits)) add(digits.substring(4));
  if (/^00\d{5,}$/.test(digits)) add(digits.substring(2));
  return keys;
}

function isPhonePrefixQuery_(value) {
  const digits = normalizePhone_(value);
  return /^0(10|11|12|15)\d*$/.test(digits) ||
    /^(10|11|12|15)\d*$/.test(digits) ||
    /^20(10|11|12|15)\d*$/.test(digits) ||
    /^0020(10|11|12|15)\d*$/.test(digits) ||
    /^00[1-9]\d{2,}$/.test(digits);
}

function cleanSheetDisplayValue_(value) {
  const text = String(value == null ? '' : value).trim();
  if (/^#(ERROR|REF|VALUE|N\/A|NAME|DIV\/0|NUM|NULL)!?$/i.test(text)) return '';
  return text;
}

function formatPhoneDisplayValue_(value) {
  const text = cleanSheetDisplayValue_(value);
  if (!text) return '';

  const parts = text
    .split(/[,،;|/\n\r]+|\s+[-–—]\s+/)
    .map(function(part) { return part.trim(); })
    .filter(Boolean);

  return parts.map(function(part) {
    let digits = normalizePhone_(part);
    if (/^(10|11|12|15)\d{8}$/.test(digits)) {
      digits = '0' + digits;
    }
    return digits || part;
  }).join(', ');
}

function formatEmailDisplayValue_(value) {
  return cleanSheetDisplayValue_(value);
}

function normalizeArabic_(text) {
  return String(text || '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchText_(text) {
  return normalizeArabic_(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* =================================================
 * VALIDATION
 * ================================================= */

function validateFullName_(fullName) {
  const normalized = normalizeText_(fullName);
  if (!normalized) throw new Error('Please enter your full name.');

  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length < 3) throw new Error('Please enter at least your first, middle and last name.');
  if (normalized.length > 150) throw new Error('Name is too long.');

  return normalized;
}

function validateEmail_(email) {
  const normalized = normalizeEmail_(email);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(normalized)) throw new Error('Please enter a valid email address.');
  if (normalized.length > 254) throw new Error('Email address is too long.');

  return normalized;
}

function validatePhone_(phone) {
  const normalized = normalizePhone_(phone);
  if (normalized.length < 7 || normalized.length > 15) throw new Error('Please enter a valid phone number.');
  return normalized;
}

function validatePassword_(password) {
  if (!password || typeof password !== 'string') throw new Error('Password is required.');
  if (password.length < 10) throw new Error('Password must contain at least 10 characters.');
  if (password.length > 128) throw new Error('Password is too long.');
  return password;
}

/* =================================================
 * RANDOM / HASHING
 * ================================================= */

function createSalt_() {
  const raw = Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + Utilities.getUuid();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return bytesToHex_(digest);
}

function bytesToHex_(bytes) {
  return bytes
    .map(function(byte) {
      const value = byte < 0 ? byte + 256 : byte;
      return ('0' + value.toString(16)).slice(-2);
    })
    .join('');
}

function hashPassword_(password, saltHex) {
  const pepper = getRequiredProperty_('PASSWORD_PEPPER');
  let data = password + '|' + saltHex + '|' + pepper;
  let digest = Utilities.computeHmacSha256Signature(data, pepper);

  for (let i = 0; i < APP.SECURITY.PASSWORD_ITERATIONS; i++) {
    digest = Utilities.computeHmacSha256Signature(bytesToHex_(digest), pepper);
  }

  return bytesToHex_(digest);
}

function createVerificationToken_() {
  const token = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
  const pepper = getRequiredProperty_('PASSWORD_PEPPER');
  const digest = Utilities.computeHmacSha256Signature(token, pepper);

  return { token: token, hash: bytesToHex_(digest) };
}

function hashVerificationToken_(token) {
  const pepper = getRequiredProperty_('PASSWORD_PEPPER');
  const digest = Utilities.computeHmacSha256Signature(String(token || ''), pepper);
  return bytesToHex_(digest);
}

function hashToken_(token) {
  return hashVerificationToken_(token);
}

/* =================================================
 * SYSTEM SHEETS
 * ================================================= */

function getSystemSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getUsersSheet_() {
  const sheet = getSystemSpreadsheet_().getSheetByName(APP.SHEETS.USERS);
  if (!sheet) throw new Error('Users sheet not found.');
  return sheet;
}

function getSearchLogsSheet_() {
  const sheet = getSystemSpreadsheet_().getSheetByName(APP.SHEETS.SEARCH_LOGS);
  if (!sheet) throw new Error('SearchLogs sheet not found.');
  return sheet;
}

function getAdminLogsSheet_() {
  const sheet = getSystemSpreadsheet_().getSheetByName(APP.SHEETS.ADMIN_LOGS);
  if (!sheet) throw new Error('AdminLogs sheet not found.');
  return sheet;
}

/* =================================================
 * INITIALIZE SYSTEM
 * ================================================= */

function initializeSystem() {
  setupUsersSheet_();
  setupSearchLogsSheet_();
  setupAdminLogsSheet_();
  setupActivityLogSheet_();
  setupSettingsSheet_();
  buildPhoneSearchIndex_();

  return 'PVC Collection system initialized successfully.';
}

function getPhoneIndexSheet_() {
  const sheet = getSystemSpreadsheet_().getSheetByName(APP.SHEETS.PHONE_INDEX);
  if (!sheet) throw new Error('PhoneIndex sheet not found. Run initializeSystem().');
  return sheet;
}

function getPhoneBucketsSheet_() {
  const sheet = getSystemSpreadsheet_().getSheetByName(APP.SHEETS.PHONE_BUCKETS);
  if (!sheet) throw new Error('PhoneBuckets sheet not found. Run initializeSystem().');
  return sheet;
}

function buildPhoneSearchIndex_() {
  const ss = getSystemSpreadsheet_();
  const customerSheet = getCustomerSheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('The phone search index is already being rebuilt. Please try again shortly.');
  }

  const lastRow = customerSheet.getLastRow();
  const indexName = APP.SHEETS.PHONE_INDEX;
  const bucketsName = APP.SHEETS.PHONE_BUCKETS;
  const suffix = String(Date.now());
  const stageIndexName = '_BUILD_PHONE_INDEX_' + suffix;
  const stageBucketsName = '_BUILD_PHONE_BUCKETS_' + suffix;
  const backupIndexName = '_OLD_PHONE_INDEX_' + suffix;
  const backupBucketsName = '_OLD_PHONE_BUCKETS_' + suffix;
  const READ_BATCH = 10000;
  const WRITE_BATCH = 5000;
  const PREFIX_LENGTH = 5;

  let stageIndex = null;
  let stageBuckets = null;
  let oldIndexRenamed = false;
  let oldBucketsRenamed = false;
  let newIndexInstalled = false;
  let newBucketsInstalled = false;

  try {
    const index = [];
    const seen = Object.create(null);

    for (let firstRow = 2; firstRow <= lastRow; firstRow += READ_BATCH) {
      const count = Math.min(READ_BATCH, lastRow - firstRow + 1);
      const data = customerSheet.getRange(firstRow, 2, count, 2).getDisplayValues();
      data.forEach(function(row, offset) {
        const sourceRow = firstRow + offset;
        phoneSearchKeys_(row[0]).concat(phoneSearchKeys_(row[1])).forEach(function(key) {
          const dedupe = key + '|' + sourceRow;
          if (!seen[dedupe]) {
            seen[dedupe] = true;
            index.push([key, sourceRow]);
          }
        });
      });
    }

    index.sort(function(a, b) {
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      return a[1] - b[1];
    });

    const buckets = [];
    let currentPrefix = '';
    let startIndex = 0;
    for (let i = 0; i < index.length; i++) {
      const prefix = String(index[i][0]).substring(0, PREFIX_LENGTH);
      if (prefix !== currentPrefix) {
        if (currentPrefix) buckets.push([currentPrefix, startIndex + 2, i + 1]);
        currentPrefix = prefix;
        startIndex = i;
      }
    }
    if (currentPrefix) buckets.push([currentPrefix, startIndex + 2, index.length + 1]);

    stageIndex = ss.insertSheet(stageIndexName);
    stageBuckets = ss.insertSheet(stageBucketsName);
    stageIndex.getRange(1, 1, 1, 2).setValues([['PhoneKey', 'SourceRow']]);
    stageBuckets.getRange(1, 1, 1, 3).setValues([['Prefix', 'StartRow', 'EndRow']]);

    const requiredIndexRows = index.length + 1;
    if (stageIndex.getMaxRows() < requiredIndexRows) {
      stageIndex.insertRowsAfter(stageIndex.getMaxRows(), requiredIndexRows - stageIndex.getMaxRows());
    }
    const requiredBucketRows = buckets.length + 1;
    if (stageBuckets.getMaxRows() < requiredBucketRows) {
      stageBuckets.insertRowsAfter(stageBuckets.getMaxRows(), requiredBucketRows - stageBuckets.getMaxRows());
    }
    if (index.length) stageIndex.getRange(2, 1, index.length, 1).setNumberFormat('@');
    if (buckets.length) stageBuckets.getRange(2, 1, buckets.length, 1).setNumberFormat('@');

    for (let i = 0; i < index.length; i += WRITE_BATCH) {
      const chunk = index.slice(i, i + WRITE_BATCH);
      stageIndex.getRange(i + 2, 1, chunk.length, 2).setValues(chunk);
    }
    for (let i = 0; i < buckets.length; i += WRITE_BATCH) {
      const chunk = buckets.slice(i, i + WRITE_BATCH);
      stageBuckets.getRange(i + 2, 1, chunk.length, 3).setValues(chunk);
    }
    SpreadsheetApp.flush();

    const oldIndex = ss.getSheetByName(indexName);
    const oldBuckets = ss.getSheetByName(bucketsName);
    if (oldIndex) {
      oldIndex.setName(backupIndexName);
      oldIndexRenamed = true;
    }
    if (oldBuckets) {
      oldBuckets.setName(backupBucketsName);
      oldBucketsRenamed = true;
    }

    stageIndex.setName(indexName);
    newIndexInstalled = true;
    stageBuckets.setName(bucketsName);
    newBucketsInstalled = true;

    if (oldIndexRenamed) {
      const backup = ss.getSheetByName(backupIndexName);
      if (backup) { try { ss.deleteSheet(backup); } catch (e) {} }
    }
    if (oldBucketsRenamed) {
      const backup = ss.getSheetByName(backupBucketsName);
      if (backup) { try { ss.deleteSheet(backup); } catch (e) {} }
    }

    return 'Phone search index built: ' + index.length + ' keys in ' + buckets.length + ' buckets.';

  } catch (error) {
    if (newBucketsInstalled) {
      const installed = ss.getSheetByName(bucketsName);
      if (installed) ss.deleteSheet(installed);
    }
    if (newIndexInstalled) {
      const installed = ss.getSheetByName(indexName);
      if (installed) ss.deleteSheet(installed);
    }
    if (oldIndexRenamed) {
      const backup = ss.getSheetByName(backupIndexName);
      if (backup) backup.setName(indexName);
    }
    if (oldBucketsRenamed) {
      const backup = ss.getSheetByName(backupBucketsName);
      if (backup) backup.setName(bucketsName);
    }
    throw error;

  } finally {
    try {
      [stageIndexName, stageBucketsName, backupIndexName, backupBucketsName].forEach(function(name) {
        const leftover = ss.getSheetByName(name);
        if (leftover) {
          try { ss.deleteSheet(leftover); } catch (e) {}
        }
      });
    } finally {
      lock.releaseLock();
    }
  }
}

function findPhoneIndexRows_(searchKey, allowPartial) {
  const key = normalizePhone_(searchKey);
  const PREFIX_LENGTH = 5;
  if (!key || key.length < (allowPartial ? 4 : APP.SECURITY.MIN_PHONE_DIGITS)) return [];

  const partial = Boolean(allowPartial);
  const prefix = key.substring(0, Math.min(PREFIX_LENGTH, key.length));
  const bucketsSheet = getPhoneBucketsSheet_();
  const bucketCount = bucketsSheet.getLastRow() - 1;
  if (bucketCount < 1) return [];

  const bucketFinder = bucketsSheet.getRange(2, 1, bucketCount, 1)
    .createTextFinder(partial && key.length < PREFIX_LENGTH ? '^' + prefix : prefix)
    .matchCase(false)
    .matchEntireCell(!partial || key.length >= PREFIX_LENGTH)
    .useRegularExpression(partial && key.length < PREFIX_LENGTH);
  const bucketCells = partial && key.length < PREFIX_LENGTH
    ? bucketFinder.findAll()
    : [bucketFinder.findNext()].filter(Boolean);

  if (!bucketCells.length) return [];

  const indexSheet = getPhoneIndexSheet_();
  const sourceRows = [];

  bucketCells.forEach(function(bucketCell) {
    const bucket = bucketsSheet.getRange(bucketCell.getRow(), 1, 1, 3).getValues()[0];
    const startRow = Number(bucket[1]);
    const endRow = Number(bucket[2]);
    if (!startRow || !endRow || endRow < startRow) return;

    const bucketSize = endRow - startRow + 1;
    const indexRange = indexSheet.getRange(startRow, 1, bucketSize, 1);
    const matches = indexRange.createTextFinder(key)
      .matchCase(false)
      .matchEntireCell(!partial)
      .findAll();
    if (!matches.length) return;

    const offsets = matches.map(function(cell) {
      return cell.getRow() - startRow;
    }).sort(function(a, b) { return a - b; });

    let i = 0;
    while (i < offsets.length) {
      const firstOffset = offsets[i];
      let lastOffset = firstOffset;
      let j = i + 1;
      while (j < offsets.length && offsets[j] === lastOffset + 1) {
        lastOffset = offsets[j];
        j++;
      }
      const values = indexSheet.getRange(
        startRow + firstOffset, 2, lastOffset - firstOffset + 1, 1
      ).getValues();
      values.forEach(function(row) { sourceRows.push(Number(row[0])); });
      i = j;
    }
  });

  return uniqueRows_(sourceRows).filter(function(rowNumber) {
    return Number.isInteger(rowNumber) && rowNumber >= 2;
  });
}

function setupUsersSheet_() {
  const ss = getSystemSpreadsheet_();
  let sheet = ss.getSheetByName(APP.SHEETS.USERS);
  if (!sheet) sheet = ss.insertSheet(APP.SHEETS.USERS);

  const headers = [
    'UserID', 'FullName', 'Phone', 'Email', 'PasswordHash', 'Status',
    'EmailVerified', 'VerificationTokenHash', 'VerificationExpiresAt',
    'CreatedAt', 'ApprovedAt', 'LastLogin', 'ResetTokenHash',
    'ResetExpiresAt', 'Role'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  if (sheet.getLastRow() > 1) {
    const rowCount = sheet.getLastRow() - 1;
    const roleRange = sheet.getRange(2, 15, rowCount, 1);
    const roles = roleRange.getValues();
    const emails = sheet.getRange(2, 4, rowCount, 1).getValues();
    roles.forEach(function(r, i) {
      if (isAdminEmail_(String(emails[i][0] || ''))) {
        r[0] = APP.USER_ROLE.ADMIN;
      } else if (!String(r[0] || '').trim()) {
        r[0] = APP.USER_ROLE.USER;
      }
    });
    roleRange.setValues(roles);
  }

  return sheet;
}

function setupSearchLogsSheet_() {
  const ss = getSystemSpreadsheet_();
  let sheet = ss.getSheetByName(APP.SHEETS.SEARCH_LOGS);
  if (!sheet) sheet = ss.insertSheet(APP.SHEETS.SEARCH_LOGS);

  const headers = ['Timestamp', 'UserID', 'UserEmail', 'SearchType', 'SearchQuery', 'ResultCount', 'Success'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return sheet;
}

function setupAdminLogsSheet_() {
  const ss = getSystemSpreadsheet_();
  let sheet = ss.getSheetByName(APP.SHEETS.ADMIN_LOGS);
  if (!sheet) sheet = ss.insertSheet(APP.SHEETS.ADMIN_LOGS);

  const headers = ['Timestamp', 'AdminEmail', 'Action', 'TargetUserID', 'TargetEmail', 'Details'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return sheet;
}

function setupSettingsSheet_() {
  const ss = getSystemSpreadsheet_();
  let sheet = ss.getSheetByName(APP.SHEETS.SETTINGS);
  if (!sheet) sheet = ss.insertSheet(APP.SHEETS.SETTINGS);

  const headers = ['Key', 'Value'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return sheet;
}

function setupActivityLogSheet_() {
  const ss = getSystemSpreadsheet_();
  let sheet = ss.getSheetByName(APP.SHEETS.ACTIVITY_LOG);
  const created = !sheet;
  if (!sheet) sheet = ss.insertSheet(APP.SHEETS.ACTIVITY_LOG);

  if (created || sheet.getLastRow() === 0 || !String(sheet.getRange(1, 1).getValue() || '').trim()) {
    const headers = ['Timestamp','UserID','UserEmail','EventType','SearchType','ResultCount','Details'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

function logActivity_(session, eventType, searchType, resultCount, details) {
  try {
    const sheet = setupActivityLogSheet_();
    sheet.appendRow([
      new Date(), session.userId, session.email, eventType || '', searchType || '',
      Number(resultCount || 0), String(details || '')
    ]);
  } catch (e) {}
}

function getUserRole_(userData) {
  const role = String((userData && userData[14]) || '').trim().toUpperCase();
  if (role === APP.USER_ROLE.ADMIN) return APP.USER_ROLE.ADMIN;
  if (userData && isAdminEmail_(String(userData[3] || ''))) return APP.USER_ROLE.ADMIN;
  return APP.USER_ROLE.USER;
}

function isAdminUserData_(userData) {
  return getUserRole_(userData) === APP.USER_ROLE.ADMIN;
}

function requireRole_(sessionToken, role) {
  const session = getSession_(sessionToken);
  if (String(session.role || '').toUpperCase() !== String(role || '').toUpperCase()) {
    throw new Error('Administrator access required.');
  }
  return session;
}

function getAllUsers_() {
  const sheet = getUsersSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 15).getValues();
}

function findUserByEmail_(email) {
  const normalizedEmail = normalizeEmail_(email);
  if (!normalizedEmail) return null;

  const sheet = getUsersSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const matches = sheet.getRange(2, 4, lastRow - 1, 1)
    .createTextFinder(normalizedEmail)
    .matchCase(false)
    .matchEntireCell(true)
    .findAll();

  if (!matches.length) return null;
  const row = matches[0].getRow();
  return { row: row, data: sheet.getRange(row, 1, 1, 15).getValues()[0] };
}

function findUserById_(userId) {
  const id = String(userId || '').trim();
  if (!id) return null;

  const sheet = getUsersSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const matches = sheet.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(id)
    .matchCase(true)
    .matchEntireCell(true)
    .findAll();

  if (!matches.length) return null;
  const row = matches[0].getRow();
  return { row: row, data: sheet.getRange(row, 1, 1, 15).getValues()[0] };
}

function checkRateLimit_(scope, key, limit, windowSeconds) {
  const cache = CacheService.getScriptCache();
  const safeKey = 'RL_' + scope + '_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(key || ''))).slice(0, 40);
  const raw = cache.get(safeKey);
  const now = Date.now();
  let item = raw ? JSON.parse(raw) : null;
  if (!item || now - item.startedAt >= windowSeconds * 1000) item = { startedAt: now, count: 0 };
  item.count += 1;
  cache.put(safeKey, JSON.stringify(item), windowSeconds);
  if (item.count > limit) throw new Error('Too many requests. Please wait and try again later.');
}

function checkLoginRateLimit_(email) {
  checkRateLimit_('LOGIN', normalizeEmail_(email), APP.SECURITY.LOGIN_RATE_LIMIT, APP.SECURITY.LOGIN_RATE_WINDOW_SECONDS);
}

function checkSignupRateLimit_(email) {
  checkRateLimit_('SIGNUP', normalizeEmail_(email), APP.SECURITY.SIGNUP_RATE_LIMIT, APP.SECURITY.SIGNUP_RATE_WINDOW_SECONDS);
}

function checkSearchRateLimit_(userId) {
  checkRateLimit_('SEARCH', String(userId), APP.SECURITY.SEARCH_RATE_LIMIT, APP.SECURITY.SEARCH_RATE_WINDOW_SECONDS);
}

function signupUser(form) {
  if (!form) throw new Error('Invalid registration request.');

  const fullName = validateFullName_(form.fullName);
  const phone = validatePhone_(form.phone);
  const email = validateEmail_(form.email);
  checkSignupRateLimit_(email);

  const password = validatePassword_(form.password);
  const confirmPassword = String(form.confirmPassword || '');
  if (password !== confirmPassword) throw new Error('Passwords do not match.');

  const adminEmail = normalizeEmail_(getRequiredProperty_('ADMIN_EMAIL'));
  if (email === adminEmail) {
    throw new Error('This email cannot be registered through the public signup form.');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('System is busy. Please try again.');

  try {
    const existing = findUserByEmail_(email);
    if (existing) {
      throw new Error('Unable to create this account. Please check the information and try again.');
    }

    const userId = Utilities.getUuid();
    const salt = createSalt_();
    const passwordHash = hashPassword_(password, salt);
    const verification = createVerificationToken_();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + APP.SECURITY.VERIFICATION_MINUTES * 60 * 1000);

    const sheet = getUsersSheet_();
    sheet.appendRow([
      userId, fullName, phone, email, passwordHash + ':' + salt,
      APP.USER_STATUS.PENDING, 'FALSE', verification.hash,
      expiresAt, now, '', '', '', '', APP.USER_ROLE.USER
    ]);

    const createdRow = sheet.getLastRow();
    try {
      sendVerificationEmail_(email, fullName, verification.token, expiresAt);
    } catch (mailError) {
      if (sheet.getLastRow() === createdRow && String(sheet.getRange(createdRow, 1).getValue()) === userId) {
        sheet.deleteRow(createdRow);
      }
      throw new Error('Unable to send the verification email. Please try again later.');
    }

    return {
      success: true,
      message: 'Account created. Please check your email to verify your account.'
    };

  } finally {
    lock.releaseLock();
  }
}

function sendVerificationEmail_(email, fullName, token, expiresAt) {
  const webAppUrl = getRequiredProperty_('WEB_APP_URL');
  const verificationUrl = webAppUrl + '?action=verify&token=' + encodeURIComponent(token);
  const subject = 'PVC Collection - Verify your email';
  const body = 'Hello ' + fullName + ',\n\n' +
    'Thank you for registering for PVC Collection.\n\n' +
    'Please verify your email using the following link:\n\n' +
    verificationUrl + '\n\n' +
    'This verification link expires at:\n' + expiresAt.toISOString() + '\n\n' +
    'After verification, your account will remain pending until an administrator approves it.\n\n' +
    'PVC Collection';

  if (MailApp.getRemainingDailyQuota() <= 0) {
    throw new Error('Email sending limit has been reached. Please try again later.');
  }

  MailApp.sendEmail({ to: email, subject: subject, body: body });
}

function handleEmailVerification_(e) {
  try {
    const token = e && e.parameter && e.parameter.token ? String(e.parameter.token) : '';
    if (!token) {
      return HtmlService.createHtmlOutput(buildVerificationPage_(false, 'Invalid verification link.'));
    }

    const tokenHash = hashVerificationToken_(token);
    const sheet = getUsersSheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      return HtmlService.createHtmlOutput(buildVerificationPage_(false, 'Invalid or expired verification link.'));
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const storedHash = String(row[7] || '');

      if (storedHash && storedHash === tokenHash) {
        const rowNumber = i + 2;
        const expiresAt = row[8];

        if (!expiresAt || new Date(expiresAt).getTime() < new Date().getTime()) {
          return HtmlService.createHtmlOutput(buildVerificationPage_(false, 'This verification link has expired.'));
        }

        sheet.getRange(rowNumber, 7).setValue('TRUE');
        sheet.getRange(rowNumber, 8).clearContent();
        sheet.getRange(rowNumber, 9).clearContent();

        return HtmlService.createHtmlOutput(
          buildVerificationPage_(true, 'Your email has been verified successfully. Your account is now waiting for administrator approval.')
        );
      }
    }

    return HtmlService.createHtmlOutput(buildVerificationPage_(false, 'Invalid or expired verification link.'));

  } catch (error) {
    return HtmlService.createHtmlOutput(buildVerificationPage_(false, 'Unable to verify this email. Please try again.'));
  }
}

function buildVerificationPage_(success, message) {
  const title = success ? 'Email Verified' : 'Verification Failed';
  const color = success ? '#16803c' : '#b42318';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml_(title) + '</title></head><body style="margin:0;font-family:Arial,sans-serif;background:#f5f7fa;display:flex;align-items:center;justify-content:center;min-height:100vh;"><div style="background:white;max-width:520px;margin:20px;padding:35px;border-radius:14px;box-shadow:0 4px 20px rgba(0,0,0,.08);text-align:center;"><h1 style="color:' + color + ';margin-bottom:20px;">' + escapeHtml_(title) + '</h1><p style="color:#333;line-height:1.7;font-size:16px;">' + escapeHtml_(message) + '</p><p style="color:#777;margin-top:25px;">PVC Collection</p></div></body></html>';
}

function requestPasswordReset(email) {
  const normalizedEmail = validateEmail_(email);
  checkRateLimit_('RESET', normalizedEmail, APP.SECURITY.RESET_RATE_LIMIT, APP.SECURITY.RESET_RATE_WINDOW_SECONDS);

  const generic = {
    success: true,
    message: 'If this email is eligible, a password reset link has been sent.'
  };

  let user = findUserByEmail_(normalizedEmail);

  if (!user && isAdminEmail_(normalizedEmail)) {
    const sheet = getUsersSheet_();
    const userId = Utilities.getUuid();
    const salt = createSalt_();
    const randomPassword = Utilities.getUuid() + Utilities.getUuid();
    const passwordHash = hashPassword_(randomPassword, salt);
    const now = new Date();
    sheet.appendRow([
      userId, getRequiredProperty_('ADMIN_NAME'), '', normalizedEmail,
      passwordHash + ':' + salt, APP.USER_STATUS.ACTIVE, 'TRUE', '', '',
      now, now, '', '', '', APP.USER_ROLE.ADMIN
    ]);
    user = findUserByEmail_(normalizedEmail);
  }

  if (!user || !normalizeBoolean_(user.data[6])) return generic;

  const token = createVerificationToken_();
  const expiresAt = new Date(Date.now() + APP.SECURITY.RESET_MINUTES * 60000);
  const sheet = getUsersSheet_();
  sheet.getRange(user.row, 13).setValue(token.hash);
  sheet.getRange(user.row, 14).setValue(expiresAt);

  const url = getRequiredProperty_('WEB_APP_URL') + '?action=reset&token=' + encodeURIComponent(token.token);
  try {
    if (MailApp.getRemainingDailyQuota() <= 0) throw new Error('No email quota.');
    MailApp.sendEmail({
      to: normalizedEmail,
      subject: 'PVC Collection - Reset your password',
      body: 'Hello ' + String(user.data[1] || '') + ',\n\nUse this link to reset your PVC Collection password:\n\n' +
        url + '\n\nThis link expires in ' + APP.SECURITY.RESET_MINUTES + ' minutes.\n\n' +
        'If you did not request this, you can ignore this email.\n\nPVC Collection'
    });
  } catch (error) {
    sheet.getRange(user.row, 13, 1, 2).clearContent();
  }
  return generic;
}

function resetPassword(token, newPassword, confirmPassword) {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) throw new Error('Invalid or expired reset link.');

  const password = validatePassword_(String(newPassword || ''));
  const confirmation = String(confirmPassword || '');
  if (password !== confirmation) throw new Error('Passwords do not match.');

  const tokenHash = hashToken_(cleanToken);
  const sheet = getUsersSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Invalid or expired reset link.');

  const data = sheet.getRange(2, 1, lastRow - 1, Math.max(14, sheet.getLastColumn())).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][12] || '') !== tokenHash) continue;

    const expiresAt = data[i][13];
    if (!expiresAt || new Date(expiresAt).getTime() < Date.now()) {
      throw new Error('This reset link has expired.');
    }

    const salt = createSalt_();
    const passwordHash = hashPassword_(password, salt);
    const rowNumber = i + 2;

    sheet.getRange(rowNumber, 5).setValue(passwordHash + ':' + salt);
    sheet.getRange(rowNumber, 13, 1, 2).clearContent();

    return { success: true, message: 'Your password has been reset successfully. You can now log in.' };
  }

  throw new Error('Invalid or expired reset link.');
}

function buildResetPage_(token) {
  const hasToken = Boolean(token);
  const appUrl = escapeHtml_(getRequiredProperty_('WEB_APP_URL'));

  const body = hasToken ?
    '<h1>Password reset</h1>' +
    '<p class="muted">Create a new password for your PVC Collection account.</p>' +
    '<div id="alert" class="hidden"></div>' +
    '<form onsubmit="submitReset(event)">' +
    '<label>New password</label><div class="pass-wrap"><input id="password" type="password" minlength="10" maxlength="128" required><button class="show-pass" type="button" onclick="togglePass(\'password\',this)">Show</button></div>' +
    '<label>Confirm password</label><div class="pass-wrap"><input id="confirm" type="password" minlength="10" maxlength="128" required><button class="show-pass" type="button" onclick="togglePass(\'confirm\',this)">Show</button></div>' +
    '<button id="btn" type="submit">Reset password</button></form>' +
    '<p><a href="' + appUrl + '">Back to login</a></p>' :
    '<h1>Forgot password?</h1>' +
    '<p class="muted">Enter your account email. If eligible, we will send a reset link.</p>' +
    '<div id="alert" class="hidden"></div>' +
    '<form onsubmit="requestReset(event)">' +
    '<label>Email</label><input id="email" type="email" autocomplete="email" required>' +
    '<button id="btn" type="submit">Send reset link</button></form>' +
    '<p><a href="' + appUrl + '">Back to login</a></p>';

  const html = '<!doctype html><html><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>PVC Collection - Password</title><style>' +
    'body{margin:0;background:#f5f7fa;font-family:Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}' +
    '.card{width:min(460px,calc(100% - 32px));background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:30px;box-shadow:0 12px 35px rgba(0,0,0,.08)}' +
    'h1{margin:0 0 8px;font-size:25px}.muted{color:#6b7280;line-height:1.6}label{display:block;font-weight:700;margin:18px 0 7px}' +
    'input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:15px}.pass-wrap{display:flex;gap:8px}.pass-wrap input{flex:1;min-width:0}.show-pass{width:auto;margin:0;padding:0 14px;background:#e5e7eb;color:#111827;border:0;border-radius:10px;font-weight:700;cursor:pointer}' +
    'button{width:100%;margin-top:20px;padding:13px;border:0;border-radius:10px;background:#111827;color:#fff;font-weight:700;cursor:pointer}' +
    'a{color:#111827}.hidden{display:none}.ok{background:#ecfdf3;color:#166534;padding:12px;border-radius:10px;margin:12px 0}.err{background:#fef2f2;color:#991b1b;padding:12px;border-radius:10px;margin:12px 0}' +
    '</style></head><body><div class="card">' + body + '</div><script>' +
    'const TOKEN=' + JSON.stringify(token || '') + ';' +
    'function show(msg,ok){const a=document.getElementById("alert");a.className=ok?"ok":"err";a.textContent=msg}' +
    'function togglePass(id,btn){const x=document.getElementById(id);const show=x.type==="password";x.type=show?"text":"password";btn.textContent=show?"Hide":"Show"}' +
    'function requestReset(e){e.preventDefault();const b=document.getElementById("btn");b.disabled=true;google.script.run.withSuccessHandler(function(r){b.disabled=false;show(r.message,true)}).withFailureHandler(function(err){b.disabled=false;show(err.message||"Request failed.",false)}).requestPasswordReset(document.getElementById("email").value)}' +
    'function submitReset(e){e.preventDefault();const b=document.getElementById("btn");b.disabled=true;google.script.run.withSuccessHandler(function(r){b.disabled=false;show(r.message,true);document.querySelector("form").reset()}).withFailureHandler(function(err){b.disabled=false;show(err.message||"Reset failed.",false)}).resetPassword(TOKEN,document.getElementById("password").value,document.getElementById("confirm").value)}' +
    '<\/script></body></html>';

  return HtmlService.createHtmlOutput(html).setTitle('PVC Collection - Password');
}

function loginUser(form) {
  if (!form) throw new Error('Invalid login request.');

  const email = validateEmail_(form.email);
  checkLoginRateLimit_(email);

  const password = String(form.password || '');
  if (!password) throw new Error('Email or password is incorrect.');

  const user = findUserByEmail_(email);
  if (!user) throw new Error('Email or password is incorrect.');

  const row = user.data;
  const userId = String(row[0]);
  const storedPassword = String(row[4] || '');
  const status = String(row[5] || '');
  const emailVerified = String(row[6] || '').toUpperCase();

  const parts = storedPassword.split(':');
  if (parts.length !== 2) throw new Error('Unable to authenticate this account.');

  const storedHash = parts[0];
  const salt = parts[1];
  const calculatedHash = hashPassword_(password, salt);

  if (!constantTimeEquals_(calculatedHash, storedHash)) {
    throw new Error('Email or password is incorrect.');
  }

  if (emailVerified !== 'TRUE') throw new Error('Please verify your email before logging in.');
  if (status === APP.USER_STATUS.PENDING) throw new Error('Your account is waiting for administrator approval.');
  if (status === APP.USER_STATUS.REJECTED) throw new Error('Your account was not approved.');
  if (status === APP.USER_STATUS.DISABLED) throw new Error('Your account has been disabled.');
  if (status !== APP.USER_STATUS.ACTIVE) throw new Error('Your account is not active.');

  getUsersSheet_().getRange(user.row, 12).setValue(new Date());

  const role = getUserRole_(row);
  const session = createSession_(userId, email, role);

  return {
    success: true,
    sessionToken: session.token,
    user: {
      userId: userId,
      fullName: String(row[1]),
      email: email,
      role: role
    }
  };
}

function constantTimeEquals_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function createSession_(userId, email, role) {
  const token = Utilities.getUuid() + Utilities.getUuid();
  const pepper = getRequiredProperty_('PASSWORD_PEPPER');
  const tokenHash = bytesToHex_(Utilities.computeHmacSha256Signature(token, pepper));
  const expiresAt = new Date(Date.now() + APP.SECURITY.SESSION_MINUTES * 60 * 1000);

  const cache = CacheService.getScriptCache();
  cache.put(
    'SESSION_' + tokenHash,
    JSON.stringify({
      userId: userId,
      email: email,
      role: role || APP.USER_ROLE.USER,
      expiresAt: expiresAt.toISOString()
    }),
    APP.SECURITY.SESSION_MINUTES * 60
  );

  return {
    token: token,
    expiresAt: expiresAt.toISOString()
  };
}

function getSession_(sessionToken) {
  if (!sessionToken) throw new Error('Session expired. Please login again.');

  const pepper = getRequiredProperty_('PASSWORD_PEPPER');
  const tokenHash = bytesToHex_(Utilities.computeHmacSha256Signature(String(sessionToken), pepper));
  const cache = CacheService.getScriptCache();
  const raw = cache.get('SESSION_' + tokenHash);

  if (!raw) throw new Error('Session expired. Please login again.');

  const session = JSON.parse(raw);
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    cache.remove('SESSION_' + tokenHash);
    throw new Error('Session expired. Please login again.');
  }

  const currentUser = findUserById_(session.userId);
  if (!currentUser || normalizeEmail_(currentUser.data[3]) !== normalizeEmail_(session.email) ||
      String(currentUser.data[5]) !== APP.USER_STATUS.ACTIVE ||
      String(currentUser.data[6]).toUpperCase() !== 'TRUE') {
    cache.remove('SESSION_' + tokenHash);
    throw new Error('Session expired. Please login again.');
  }

  session.role = getUserRole_(currentUser.data);
  return session;
}

function logoutUser(sessionToken) {
  if (!sessionToken) return { success: true };

  const pepper = getRequiredProperty_('PASSWORD_PEPPER');
  const tokenHash = bytesToHex_(Utilities.computeHmacSha256Signature(String(sessionToken), pepper));
  CacheService.getScriptCache().remove('SESSION_' + tokenHash);

  return { success: true };
}

function getCustomerSpreadsheet_() {
  const spreadsheetId = getRequiredProperty_('CUSTOMER_DB_ID');
  return SpreadsheetApp.openById(spreadsheetId);
}

function getCustomerSheet_() {
  const spreadsheet = getCustomerSpreadsheet_();
  const sheetName = getRequiredProperty_('CUSTOMER_DB_SHEET');
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('Customer database sheet not found.');
  return sheet;
}

function validateSearchQuery_(query, type) {
  const normalizedType = String(type || '').toLowerCase().trim();
  const raw = String(query || '').trim();

  if (!raw) throw new Error('Please enter a search value.');

  if (normalizedType === 'phone') {
    const phone = normalizePhone_(raw);
    if (phone.length < APP.SECURITY.MIN_PHONE_DIGITS) {
      throw new Error('Please enter at least ' + APP.SECURITY.MIN_PHONE_DIGITS + ' phone digits.');
    }
    return phone;
  }

  if (normalizedType === 'email') {
    const email = normalizeEmail_(raw);
    if (email.length < APP.SECURITY.MIN_EMAIL_LENGTH) {
      throw new Error('Please enter a more specific email.');
    }
    return email;
  }

  if (normalizedType === 'name') {
    const name = normalizeSearchText_(raw);
    if (name.length < APP.SECURITY.MIN_NAME_LENGTH) {
      throw new Error('Please enter a more specific name.');
    }

    const parts = name.split(' ').filter(Boolean);
    if (parts.length === 1 && parts[0].length < 5) {
      throw new Error('Please enter more than one name part for a broad name search.');
    }
    return name;
  }

  throw new Error('Invalid search type.');
}

function findTextRows_(sheet, column, lastRow, term, useRegex) {
  if (!term || lastRow < 2) return [];

  const range = sheet.getRange(2, column, lastRow - 1, 1);
  const matches = range
    .createTextFinder(String(term))
    .matchCase(false)
    .matchEntireCell(false)
    .useRegularExpression(Boolean(useRegex))
    .findAll();

  return matches.map(function(cell) { return cell.getRow(); });
}

function searchTextPattern_(term) {
  const variants = { 'ا': '[اإأآٱ]', 'ي': '[يىئ]', 'ه': '[هة]', 'و': '[وؤ]' };
  const chars = Array.from(String(term || ''));
  return chars.map(function(ch) {
    if (variants[ch]) return variants[ch];
    return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('[\u064B-\u065F\u0670\u0640]*');
}

function uniqueRows_(rows) {
  const seen = {};
  const output = [];
  rows.forEach(function(row) {
    const n = Number(row);
    if (!seen[n]) {
      seen[n] = true;
      output.push(n);
    }
  });
  return output;
}

function phoneSearchPattern_(digits) {
  const clean = normalizePhone_(digits);
  if (!clean) return '';
  return clean.split('').join('[^\\d]*');
}

function phoneQueryMatchesStored_(query, storedPhone) {
  const queryDigits = normalizePhone_(query);
  if (!queryDigits || queryDigits.length < APP.SECURITY.MIN_PHONE_DIGITS) return false;

  const queryKeys = phoneQueryKeys_(queryDigits);
  const storedKeys = phoneSearchKeys_(storedPhone);
  if (!storedKeys.length) return false;

  const isFullEgyptianMobile = /^(?:0020|20)?(?:0)?(?:10|11|12|15)\d{8}$/.test(queryDigits);
  const isLongInternational = queryDigits.length >= 10 && !isFullEgyptianMobile;
  if (isFullEgyptianMobile || isLongInternational) {
    return queryKeys.some(function(key) { return storedKeys.indexOf(key) !== -1; });
  }

  const partialKeys = phonePartialSearchKeys_(queryDigits);
  return storedKeys.some(function(storedKey) {
    return partialKeys.some(function(partialKey) { return storedKey.indexOf(partialKey) !== -1; });
  });
}

function readCustomerCandidateRows_(sheet, candidateRows, maxMatches, matcher) {
  const rows = uniqueRows_(candidateRows)
    .filter(function(rowNumber) { return rowNumber >= 2; })
    .sort(function(a, b) { return a - b; });

  const matches = [];
  const seenRecords = Object.create(null);
  const BLOCK_SIZE = 100;
  let i = 0;

  while (i < rows.length && matches.length <= maxMatches) {
    const first = rows[i];
    let last = first;
    let j = i + 1;

    while (j < rows.length && rows[j] === last + 1 && (j - i) < BLOCK_SIZE) {
      last = rows[j];
      j++;
    }

    const values = sheet.getRange(first, 1, last - first + 1, 5).getDisplayValues();
    for (let offset = 0; offset < values.length; offset++) {
      const rowNumber = first + offset;
      const row = values[offset];
      const customer = cleanSheetDisplayValue_(row[0]);
      const phone1 = formatPhoneDisplayValue_(row[1]);
      const phone2 = formatPhoneDisplayValue_(row[2]);
      const email1 = formatEmailDisplayValue_(row[3]);
      const email2 = formatEmailDisplayValue_(row[4]);

      if (!matcher({ customer: customer, phone1: phone1, phone2: phone2, email1: email1, email2: email2 })) continue;

      const recordKey = [customer, phone1, phone2, email1, email2]
        .map(function(value) { return String(value).toLowerCase().trim(); })
        .join('|');
      if (seenRecords[recordKey]) continue;
      seenRecords[recordKey] = true;

      matches.push({
        rowNumber: rowNumber,
        customer: customer,
        phone1: phone1,
        phone2: phone2,
        email1: email1,
        email2: email2
      });
      if (matches.length > maxMatches) break;
    }
    i = j;
  }

  return matches;
}

function searchCustomers(sessionToken, searchType, query) {
  const session = getSession_(sessionToken);
  checkSearchRateLimit_(session.userId);

  const cleanQuery = validateSearchQuery_(query, searchType);
  const type = String(searchType || '').toLowerCase().trim();
  const sheet = getCustomerSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    logSearch_(session, type, cleanQuery, 0, false);
    logActivity_(session, 'SEARCH', type, 0, 'NO_RESULT');
    return { success: true, results: [], resultCount: 0, limited: false };
  }

  let candidateRows = [];

  if (type === 'phone') {
    const queryDigits = normalizePhone_(cleanQuery);
    const isPartial = queryDigits.length < 10;
    const queryKeys = isPartial ? phonePartialSearchKeys_(cleanQuery) : phoneQueryKeys_(cleanQuery);
    const useIndex = !isPartial || isPhonePrefixQuery_(cleanQuery);

    if (useIndex) {
      queryKeys.forEach(function(searchKey) {
        candidateRows = candidateRows.concat(findPhoneIndexRows_(searchKey, isPartial));
      });
      candidateRows = uniqueRows_(candidateRows);
    }

    if (!candidateRows.length) {
      const fallbackKeys = queryKeys.concat([queryDigits]);
      let fallbackRows = [];
      fallbackKeys.forEach(function(searchKey) {
        const pattern = phoneSearchPattern_(searchKey);
        fallbackRows = fallbackRows.concat(
          findTextRows_(sheet, 2, lastRow, pattern, true),
          findTextRows_(sheet, 3, lastRow, pattern, true)
        );
      });
      candidateRows = uniqueRows_(fallbackRows);
    }

  } else if (type === 'email') {
    candidateRows = uniqueRows_(
      findTextRows_(sheet, 4, lastRow, cleanQuery)
        .concat(findTextRows_(sheet, 5, lastRow, cleanQuery))
    );

  } else {
    const terms = cleanQuery.split(' ').filter(Boolean);
    terms.sort(function(a, b) { return b.length - a.length; });
    candidateRows = findTextRows_(sheet, 1, lastRow, searchTextPattern_(terms[0]), true);
  }

  if (!candidateRows.length) {
    logSearch_(session, type, cleanQuery, 0, false);
    logActivity_(session, 'SEARCH', type, 0, 'NO_RESULT');
    return { success: true, results: [], resultCount: 0, limited: false };
  }

  const terms = type === 'name' ? cleanQuery.split(' ').filter(Boolean) : [];
  const matchedRows = readCustomerCandidateRows_(
    sheet, candidateRows, APP.SECURITY.MAX_SEARCH_RESULTS,
    function(record) {
      if (type === 'phone') {
        return phoneQueryMatchesStored_(cleanQuery, record.phone1) ||
          phoneQueryMatchesStored_(cleanQuery, record.phone2);
      }
      if (type === 'email') {
        return [record.email1, record.email2].some(function(email) {
          return normalizeEmail_(email).indexOf(cleanQuery) !== -1;
        });
      }
      const normalizedCustomer = normalizeSearchText_(record.customer);
      return terms.every(function(term) { return normalizedCustomer.indexOf(term) !== -1; });
    }
  );

  const limited = matchedRows.length > APP.SECURITY.MAX_SEARCH_RESULTS;
  const results = matchedRows.slice(0, APP.SECURITY.MAX_SEARCH_RESULTS).map(function(record) {
    return {
      customer: record.customer,
      phone1: record.phone1,
      phone2: record.phone2,
      email1: record.email1,
      email2: record.email2
    };
  });

  logSearch_(session, type, cleanQuery, results.length, results.length > 0);
  logActivity_(session, 'SEARCH', type, results.length, results.length > 0 ? 'SUCCESS' : 'NO_RESULT');

  return {
    success: true,
    results: results,
    resultCount: results.length,
    limited: limited
  };
}

function logSearch_(session, searchType, query, resultCount, success) {
  try {
    getSearchLogsSheet_().appendRow([
      new Date(), session.userId, session.email, searchType, query, resultCount, success ? 'TRUE' : 'FALSE'
    ]);
  } catch (e) {}
}

function recordWhatsappClick(sessionToken, phone) {
  const session = getSession_(sessionToken);
  const normalized = normalizePhone_(phone);
  if (!normalized) throw new Error('Invalid phone number.');
  logActivity_(session, 'WHATSAPP_CLICK', 'phone', 1, normalized);
  return { success: true };
}

function getEmployeeStats(sessionToken) {
  const session = getSession_(sessionToken);
  const searchSheet = getSearchLogsSheet_();
  const activitySheet = getSystemSpreadsheet_().getSheetByName(APP.SHEETS.ACTIVITY_LOG);
  let total = 0, success = 0, failed = 0, whatsapp = 0;

  if (searchSheet.getLastRow() > 1) {
    const rows = searchSheet.getRange(2, 1, searchSheet.getLastRow() - 1, 7).getValues();
    rows.forEach(function(r) {
      if (String(r[1]) !== String(session.userId)) return;
      total++;
      if (String(r[6]).toUpperCase() === 'TRUE') success++; else failed++;
    });
  }

  if (activitySheet && activitySheet.getLastRow() > 1) {
    const rows = activitySheet.getRange(2, 1, activitySheet.getLastRow() - 1, 7).getValues();
    rows.forEach(function(r) {
      if (String(r[1]) === String(session.userId) && String(r[3]) === 'WHATSAPP_CLICK') whatsapp++;
    });
  }

  return { totalSearches: total, successfulSearches: success, failedSearches: failed, whatsappClicks: whatsapp };
}

function adminGetDashboard(sessionToken) {
  const admin = requireAdminAccess_(sessionToken);
  const ss = getSystemSpreadsheet_();
  const searchSheet = getSearchLogsSheet_();
  const activitySheet = ss.getSheetByName(APP.SHEETS.ACTIVITY_LOG);
  const userMap = {};

  getAllUsers_().forEach(function(r) {
    userMap[String(r[0])] = { userId: String(r[0]), fullName: String(r[1]), email: String(r[3]) };
  });

  let total = 0, successful = 0, failed = 0;
  const byUser = {};
  const byDay = {};
  const byMonth = {};
  const recent = [];

  if (searchSheet.getLastRow() > 1) {
    const rows = searchSheet.getRange(2, 1, searchSheet.getLastRow() - 1, 7).getValues();
    rows.forEach(function(r) {
      const uid = String(r[1]);
      total++;
      const ok = String(r[6]).toUpperCase() === 'TRUE';
      if (ok) successful++; else failed++;

      const u = userMap[uid] || { userId: uid, fullName: String(r[2]), email: String(r[2]) };
      if (!byUser[uid]) {
        byUser[uid] = { userId: uid, fullName: u.fullName, email: u.email, searches: 0, successful: 0, failed: 0, whatsappClicks: 0 };
      }
      byUser[uid].searches++;
      if (ok) byUser[uid].successful++; else byUser[uid].failed++;

      const d = r[0] instanceof Date ? r[0] : new Date(r[0]);
      if (!isNaN(d.getTime())) {
        const day = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        const month = day.slice(0, 7);
        byDay[day] = (byDay[day] || 0) + 1;
        byMonth[month] = (byMonth[month] || 0) + 1;
      }
      if (recent.length < 50) {
        recent.push({ timestamp: d.toISOString(), userName: u.fullName, email: u.email, searchType: String(r[3]), found: ok, resultCount: Number(r[5] || 0) });
      }
    });
  }

  let whatsappTotal = 0;
  if (activitySheet && activitySheet.getLastRow() > 1) {
    const rows = activitySheet.getRange(2, 1, activitySheet.getLastRow() - 1, 7).getValues();
    rows.forEach(function(r) {
      if (String(r[3]) === 'WHATSAPP_CLICK') {
        whatsappTotal++;
        const uid = String(r[1]);
        if (!byUser[uid]) {
          const u = userMap[uid] || { fullName: String(r[2]), email: String(r[2]) };
          byUser[uid] = { userId: uid, fullName: u.fullName, email: u.email, searches: 0, successful: 0, failed: 0, whatsappClicks: 0 };
        }
        byUser[uid].whatsappClicks++;
      }
    });
  }

  const users = Object.keys(byUser).map(function(k) { return byUser[k]; }).sort(function(a, b) { return b.searches - a.searches; });
  return { totalSearches: total, successfulSearches: successful, failedSearches: failed, whatsappClicks: whatsappTotal, topUsers: users.slice(0, 5), byDay: byDay, byMonth: byMonth, recent: recent.reverse() };
}

function adminGetLogs(sessionToken) {
  requireAdminSession_(sessionToken);

  const ss = getSystemSpreadsheet_();
  const adminSheet = ss.getSheetByName(APP.SHEETS.ADMIN_LOGS);
  const searchSheet = ss.getSheetByName(APP.SHEETS.SEARCH_LOGS);
  const activitySheet = ss.getSheetByName(APP.SHEETS.ACTIVITY_LOG);

  function readRows(sheet, count, mapper) {
    if (!sheet || sheet.getLastRow() <= 1) return [];
    const lastRow = sheet.getLastRow();
    const startRow = Math.max(2, lastRow - count + 1);
    const values = sheet.getRange(startRow, 1, lastRow - startRow + 1, sheet.getLastColumn()).getValues();
    return values.reverse().map(mapper);
  }

  const adminActions = readRows(adminSheet, 200, function(r) {
    return {
      timestamp: toIsoDateString_(r[0]),
      adminEmail: String(r[1] || ''),
      action: String(r[2] || ''),
      targetUserId: String(r[3] || ''),
      targetEmail: String(r[4] || ''),
      details: String(r[5] || '')
    };
  });

  const searches = readRows(searchSheet, 200, function(r) {
    return {
      timestamp: toIsoDateString_(r[0]),
      userId: String(r[1] || ''),
      userEmail: String(r[2] || ''),
      searchType: String(r[3] || ''),
      query: String(r[4] || ''),
      resultCount: Number(r[5] || 0),
      success: String(r[6]).toUpperCase() === 'TRUE'
    };
  });

  const activity = readRows(activitySheet, 200, function(r) {
    return {
      timestamp: toIsoDateString_(r[0]),
      userId: String(r[1] || ''),
      userEmail: String(r[2] || ''),
      eventType: String(r[3] || ''),
      searchType: String(r[4] || ''),
      resultCount: Number(r[5] || 0),
      details: String(r[6] || '')
    };
  });

  return { adminActions: adminActions, searches: searches, activity: activity };
}

function parseXlsxCustomerFile_(base64) {
  let bytes;
  try {
    bytes = Utilities.base64Decode(String(base64 || ''));
  } catch (e) {
    throw new Error('Invalid Excel file.');
  }

  let files;
  try {
    files = Utilities.unzip(Utilities.newBlob(bytes, MimeType.MICROSOFT_EXCEL, 'import.xlsx'));
  } catch (e) {
    throw new Error('The Excel file is damaged or is not a valid .xlsx file.');
  }

  let expandedBytes = 0;
  const byName = Object.create(null);
  files.forEach(function(file) {
    expandedBytes += file.getBytes().length;
    if (expandedBytes > 30 * 1024 * 1024) throw new Error('Expanded Excel file is too large.');
    byName[String(file.getName()).replace(/^\//, '')] = file;
  });

  const workbookFile = byName['xl/workbook.xml'];
  const relsFile = byName['xl/_rels/workbook.xml.rels'];
  if (!workbookFile || !relsFile) throw new Error('Invalid Excel workbook structure.');

  const mainNs = XmlService.getNamespace('http://schemas.openxmlformats.org/spreadsheetml/2006/main');
  const relNs = XmlService.getNamespace('http://schemas.openxmlformats.org/officeDocument/2006/relationships');
  const packageRelNs = XmlService.getNamespace('http://schemas.openxmlformats.org/package/2006/relationships');
  const workbookDoc = XmlService.parse(workbookFile.getDataAsString());
  const sheetsNode = workbookDoc.getRootElement().getChild('sheets', mainNs);
  if (!sheetsNode || !sheetsNode.getChildren('sheet', mainNs).length) {
    throw new Error('Excel workbook does not contain a worksheet.');
  }

  const firstSheet = sheetsNode.getChildren('sheet', mainNs)[0];
  const relationId = firstSheet.getAttribute('id', relNs);
  if (!relationId) throw new Error('Unable to locate the first Excel worksheet.');

  const relsDoc = XmlService.parse(relsFile.getDataAsString());
  const relationship = relsDoc.getRootElement().getChildren('Relationship', packageRelNs).filter(function(rel) {
    return rel.getAttribute('Id') && rel.getAttribute('Id').getValue() === relationId.getValue();
  })[0];
  if (!relationship) throw new Error('Excel worksheet relationship is missing.');

  let target = relationship.getAttribute('Target').getValue().replace(/\\/g, '/');
  let worksheetPath;
  if (target.charAt(0) === '/') worksheetPath = target.substring(1);
  else if (target.indexOf('xl/') === 0) worksheetPath = target;
  else worksheetPath = 'xl/' + target.replace(/^\.\//, '');

  const sheetFile = byName[worksheetPath];
  if (!sheetFile) throw new Error('The first Excel worksheet could not be found.');

  const shared = [];
  const sharedFile = byName['xl/sharedStrings.xml'];
  if (sharedFile) {
    const sharedDoc = XmlService.parse(sharedFile.getDataAsString());
    sharedDoc.getRootElement().getChildren('si', mainNs).forEach(function(si) {
      const texts = [];
      function walk(node) {
        if (node.getName && node.getName() === 't') texts.push(node.getText());
        node.getChildren().forEach(walk);
      }
      walk(si);
      shared.push(texts.join(''));
    });
  }

  const doc = XmlService.parse(sheetFile.getDataAsString());
  const sheetData = doc.getRootElement().getChild('sheetData', mainNs);
  if (!sheetData) throw new Error('Excel worksheet is empty.');

  const rows = [];
  sheetData.getChildren('row', mainNs).forEach(function(rowEl) {
    const values = [];
    rowEl.getChildren('c', mainNs).forEach(function(cell) {
      const ref = cell.getAttribute('r');
      const colLetters = ref ? String(ref.getValue()).replace(/\d+$/, '') : '';
      let col = 0;
      for (let i = 0; i < colLetters.length; i++) {
        col = col * 26 + (colLetters.charCodeAt(i) - 64);
      }
      if (!col) throw new Error('Excel worksheet contains a cell with an invalid reference.');
      while (values.length < col - 1) values.push('');

      const type = cell.getAttribute('t');
      const valueNode = cell.getChild('v', mainNs);
      const inlineNode = cell.getChild('is', mainNs);
      let value = '';

      if (type && type.getValue() === 's' && valueNode) {
        const sharedIndex = Number(valueNode.getText());
        value = shared[sharedIndex] == null ? '' : shared[sharedIndex];
      } else if (type && type.getValue() === 'inlineStr' && inlineNode) {
        const texts = [];
        function walkInline(node) {
          if (node.getName && node.getName() === 't') texts.push(node.getText());
          node.getChildren().forEach(walkInline);
        }
        walkInline(inlineNode);
        value = texts.join('');
      } else if (valueNode) {
        value = valueNode.getText();
      }
      values[col - 1] = value;
    });
    rows.push(values);
  });

  return rows;
}

function importCustomerXlsx(sessionToken, base64) {
  const admin = requireAdminAccess_(sessionToken);
  if (String(base64 || '').length > 8 * 1024 * 1024) throw new Error('Import file is too large.');
  const rows = parseXlsxCustomerFile_(base64);
  if (!rows.length) throw new Error('Import file is empty.');

  const expected = ['Customer','Phone 1','Phone 2','Email 1','Email 2'];
  const header = rows[0].map(function(v) { return String(v || '').trim(); });
  if (header.length !== 5 || expected.some(function(v, i) { return header[i] !== v; })) {
    throw new Error('Invalid template. Expected: Customer, Phone 1, Phone 2, Email 1, Email 2');
  }

  const data = rows.slice(1).map(function(r) {
    const x = r.slice(0, 5);
    while (x.length < 5) x.push('');
    return x.map(function(v) { return String(v || '').trim(); });
  });

  const sheet = getCustomerSheet_();
  const last = sheet.getLastRow();
  const existing = new Set();
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, 5).getDisplayValues().forEach(function(r) {
      existing.add(r.map(function(v) { return normalizeText_(v).toLowerCase(); }).join('|'));
    });
  }

  const append = [];
  let skipped = 0;
  data.forEach(function(r, i) {
    if (!r.some(Boolean)) return;
    if (!r[0]) throw new Error('Import stopped. Row ' + (i + 2) + ': Customer is required.');
    const key = r.map(function(v) { return normalizeText_(v).toLowerCase(); }).join('|');
    if (existing.has(key)) skipped++; else { existing.add(key); append.push(r); }
  });

  if (append.length) {
    const destination = sheet.getRange(sheet.getLastRow() + 1, 1, append.length, 5);
    destination.setNumberFormat('@');
    destination.setValues(append);
    buildPhoneSearchIndex_();
  }

  logAdminAction_(admin, 'IMPORT_CUSTOMERS_XLSX', '', '', 'Added ' + append.length + ' rows; skipped ' + skipped + ' exact duplicates.');
  return { success: true, added: append.length, skipped: skipped, indexRebuilt: append.length > 0 };
}

function parseCsvText_(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let quoteClosed = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (quoteClosed && ch !== ',' && ch !== '\n' && ch !== '\r') {
      throw new Error('Invalid CSV: unexpected characters after a closing quote.');
    }

    if (ch === '"') {
      if (field.length !== 0 || quoteClosed) throw new Error('Invalid CSV: quote found inside an unquoted field.');
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      quoteClosed = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      quoteClosed = false;
      if (row.some(function(value) { return value !== ''; })) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  if (quoted) throw new Error('Invalid CSV: an opening quote was not closed.');
  row.push(field);
  if (row.some(function(value) { return value !== ''; })) rows.push(row);
  return rows;
}

function importCustomerCsv(sessionToken, csvText) {
  const admin = requireAdminAccess_(sessionToken);
  if (String(csvText || '').length > 5 * 1024 * 1024) throw new Error('Import file is too large.');
  const rows = parseCsvText_(csvText);
  if (!rows.length) throw new Error('Import file is empty.');

  const expected = ['Customer','Phone 1','Phone 2','Email 1','Email 2'];
  const header = rows[0].map(function(v) { return String(v || '').trim(); });
  if (header.length !== 5 || expected.some(function(v, i) { return header[i] !== v; })) {
    throw new Error('Invalid template. Expected: Customer, Phone 1, Phone 2, Email 1, Email 2');
  }

  const data = rows.slice(1).map(function(r) {
    const x = r.slice(0, 5);
    while (x.length < 5) x.push('');
    return x.map(function(v) { return String(v || '').trim(); });
  });

  const invalid = [], valid = [];
  data.forEach(function(r, i) {
    if (!r.some(Boolean)) return;
    if (!r[0]) invalid.push({ row: i + 2, reason: 'Customer is required' });
    else valid.push(r);
  });
  if (invalid.length) throw new Error('Import stopped. Row ' + invalid[0].row + ': ' + invalid[0].reason);

  const sheet = getCustomerSheet_();
  const last = sheet.getLastRow();
  const existing = new Set();
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, 5).getDisplayValues().forEach(function(r) {
      existing.add(r.map(function(v) { return normalizeText_(v).toLowerCase(); }).join('|'));
    });
  }

  const append = [];
  let skipped = 0;
  valid.forEach(function(r) {
    const key = r.map(function(v) { return normalizeText_(v).toLowerCase(); }).join('|');
    if (existing.has(key)) { skipped++; } else { existing.add(key); append.push(r); }
  });

  if (append.length) {
    const destination = sheet.getRange(sheet.getLastRow() + 1, 1, append.length, 5);
    destination.setNumberFormat('@');
    destination.setValues(append);
    buildPhoneSearchIndex_();
  }

  logAdminAction_(admin, 'IMPORT_CUSTOMERS', '', '', 'Added ' + append.length + ' rows; skipped ' + skipped + ' exact duplicates.');
  return { success: true, added: append.length, skipped: skipped, indexRebuilt: append.length > 0 };
}

function isAdminEmail_(email) {
  const adminEmail = normalizeEmail_(getRequiredProperty_('ADMIN_EMAIL'));
  return normalizeEmail_(email) === adminEmail;
}

function requireAdminSession_(sessionToken) {
  if (!sessionToken) throw new Error('Administrator session required.');

  const session = getSession_(sessionToken);
  if (String(session.role || '').toUpperCase() !== APP.USER_ROLE.ADMIN) {
    throw new Error('Administrator access required.');
  }
  return session;
}

function requireAdminAccess_(sessionToken) {
  return requireAdminSession_(sessionToken);
}

function toIsoDateString_(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function adminGetUsers(sessionToken) {
  const admin = requireAdminAccess_(sessionToken);
  const users = getAllUsers_();

  return users.map(function(row) {
    return {
      userId: String(row[0]),
      fullName: String(row[1]),
      phone: String(row[2]),
      email: String(row[3]),
      status: String(row[5]),
      role: getUserRole_(row),
      emailVerified: String(row[6]).toUpperCase() === 'TRUE',
      createdAt: toIsoDateString_(row[9]),
      approvedAt: toIsoDateString_(row[10]),
      lastLogin: toIsoDateString_(row[11])
    };
  });
}

function adminApproveUser(sessionToken, userId) {
  const admin = requireAdminSession_(sessionToken);
  const user = findUserById_(userId);
  if (!user) throw new Error('User not found.');

  const row = user.data;
  const emailVerified = String(row[6]).toUpperCase() === 'TRUE';
  if (!emailVerified) throw new Error('User must verify their email before approval.');

  getUsersSheet_().getRange(user.row, 6).setValue(APP.USER_STATUS.ACTIVE);
  getUsersSheet_().getRange(user.row, 11).setValue(new Date());

  logAdminAction_(admin, 'APPROVE_USER', userId, String(row[3]), 'User approved.');
  return { success: true };
}

function adminRejectUser(sessionToken, userId) {
  const admin = requireAdminSession_(sessionToken);
  const user = findUserById_(userId);
  if (!user) throw new Error('User not found.');

  const row = user.data;
  getUsersSheet_().getRange(user.row, 6).setValue(APP.USER_STATUS.REJECTED);

  logAdminAction_(admin, 'REJECT_USER', userId, String(row[3]), 'User rejected.');
  return { success: true };
}

function adminDisableUser(sessionToken, userId) {
  const admin = requireAdminSession_(sessionToken);
  const user = findUserById_(userId);
  if (!user) throw new Error('User not found.');

  const row = user.data;
  if (isAdminUserData_(row)) {
    throw new Error('The administrator account cannot be disabled from here.');
  }

  getUsersSheet_().getRange(user.row, 6).setValue(APP.USER_STATUS.DISABLED);
  logAdminAction_(admin, 'DISABLE_USER', userId, String(row[3]), 'User disabled.');
  return { success: true };
}

function adminReactivateUser(sessionToken, userId) {
  const admin = requireAdminSession_(sessionToken);
  const user = findUserById_(userId);
  if (!user) throw new Error('User not found.');

  const row = user.data;
  if (String(row[6]).toUpperCase() !== 'TRUE') {
    throw new Error('User must verify their email first.');
  }

  getUsersSheet_().getRange(user.row, 6).setValue(APP.USER_STATUS.ACTIVE);
  logAdminAction_(admin, 'REACTIVATE_USER', userId, String(row[3]), 'User reactivated.');
  return { success: true };
}

function adminSetUserRole(sessionToken, userId, role) {
  const admin = requireAdminSession_(sessionToken);
  const user = findUserById_(userId);
  if (!user) throw new Error('User not found.');

  const nextRole = String(role || '').trim().toUpperCase();
  if (nextRole !== APP.USER_ROLE.USER && nextRole !== APP.USER_ROLE.ADMIN) {
    throw new Error('Invalid role.');
  }

  const targetEmail = normalizeEmail_(String(user.data[3] || ''));
  if (targetEmail === normalizeEmail_(getRequiredProperty_('ADMIN_EMAIL')) && nextRole !== APP.USER_ROLE.ADMIN) {
    throw new Error('The configured administrator cannot be changed to USER.');
  }

  getUsersSheet_().getRange(user.row, 15).setValue(nextRole);
  logAdminAction_(admin, 'SET_USER_ROLE', userId, targetEmail, 'Role set to ' + nextRole + '.');
  return { success: true, role: nextRole };
}

function logAdminAction_(admin, action, targetUserId, targetEmail, details) {
  try {
    getAdminLogsSheet_().appendRow([
      new Date(), admin.email, action, targetUserId, targetEmail, details
    ]);
  } catch (e) {}
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function testSystemConfiguration_() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  const required = ['ADMIN_EMAIL', 'ADMIN_NAME', 'CUSTOMER_DB_ID', 'CUSTOMER_DB_SHEET', 'PASSWORD_PEPPER'];
  const missing = [];

  required.forEach(function(key) {
    if (!properties[key]) missing.push(key);
  });

  if (missing.length > 0) {
    throw new Error('Missing Script Properties: ' + missing.join(', '));
  }

  return {
    success: true,
    message: 'System configuration looks good.',
    webAppUrlConfigured: Boolean(properties.WEB_APP_URL)
  };
}

function testProductionConfiguration_() {
  const base = testSystemConfiguration_();
  const webAppUrl = getRequiredProperty_('WEB_APP_URL').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^\s]+\/exec$/.test(webAppUrl)) {
    throw new Error('WEB_APP_URL must be the deployed Google Apps Script /exec URL.');
  }
  const customerDbId = getRequiredProperty_('CUSTOMER_DB_ID');
  const customerSheetName = getRequiredProperty_('CUSTOMER_DB_SHEET');
  const customerSpreadsheet = SpreadsheetApp.openById(customerDbId);
  if (!customerSpreadsheet.getSheetByName(customerSheetName)) {
    throw new Error('Configured customer database sheet was not found.');
  }
  return {
    success: true,
    message: 'Production configuration and customer database access verified.',
    webAppUrlConfigured: true,
    customerDatabaseAccessible: true,
    requiredPropertiesConfigured: base.success
  };
}