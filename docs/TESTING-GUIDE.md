# St Anne Marie Schools OS: testing guide for the product manager (Emmanuel)

Goal: try every part of the system the way the school will use it, find what is wrong or confusing, and report it so it can be fixed. Use `docs/test-cases.csv` (open it in Excel or Google Sheets) as the checklist: 60+ cases, one row each, with a Result column for you to fill (Pass / Fail / Unclear).

## 1. Where to test (important)
- **Live site:** https://st-anne-marie-os.vercel.app. It is the real school. Anything you create there is real data and stays. So on the live site run only the cases marked **Changes data = No** (looking, searching, opening, printing).
- **Cases marked Changes data = Yes** (creating applications, payments, marks, users, exams...) must be run on a **test copy** with made-up people, never on the live school. A test copy (separate database and address, filled with made-up students, parents, fees and marks) is the right place. Until it exists, those cases wait.
- Never type real children's or parents' details into a test. Use obvious names such as "TEST Child 1" and phone numbers like 0700 000 000.

## 2. Sign-ins
Live staff accounts (the passwords are with Nino, ask him; never write them in a shared file):

| Desk | Sign in with | What this person does |
| --- | --- | --- |
| Owner | admin@stannemarie.local | Oversees; sets approval limits; manages staff accounts, website, settings; "steps in" only with a reason |
| Admissions Office | admissions@stannemarie.local | Applications, interviews, registration, students, parents |
| Academic Office | academic@stannemarie.local | Classes, exams, marks review, results, report cards, timetable, year-end decisions |
| Finance Office | finance@stannemarie.local | Fees, invoices, payments, receipts, expenses, finance reports |
| Head Teacher | head@stannemarie.local | Overview of teachers' work, second approvals |

There are no teacher, parent or student accounts on the live school yet. A test copy has demo ones (teacher1 to teacher4, parent, student).

## 3. How to test each case
1. Sign in as the person named in the "Sign in as" column.
2. Do the "What to do" steps exactly, then compare with "What should happen".
3. Write Pass, Fail or Unclear in Result. If it is not Pass, write what you saw in Notes and attach a screenshot.
4. Test on a **phone, an iPad and a computer** for the cases marked in the Devices column (at minimum the sign-in, the menu, the home page and one table on each).

## 4. How to report a problem
One line each: **case number, device and browser, what you did, what you expected, what happened, screenshot or screen recording, time it happened.** Rate it:
- **Blocker:** cannot continue, wrong money or wrong person's data, or private data shown to the wrong user.
- **Serious:** a feature gives a wrong result or an error but there is a way round.
- **Small:** wording, spacing, a button hard to tap, slow page.

## 5. Things the school must still decide (not bugs)
- SMS to parents: no SMS provider is chosen, so SMS is recorded as "not sent" and never claimed delivered.
- Online payments: no payment provider yet, so the online application fee is switched off (fee = 0).
- Fee amounts, teachers, students and parents have not been entered on the live school yet.
- Website text and the two notices come from the school's own posters and need the school's confirmation.
- Kiswahili wording needs a read-through by a native speaker.
- Backups are not set up yet.
- Photos on the website are low resolution; the school's originals are needed.

## 6. Rules the system must keep (report any breach as a Blocker)
- The owner watches and decides; he does not place students, record payments or enter marks without "stepping in" (reason, 30 minutes, banner, audit entry).
- A payment is never marked paid unless it was really recorded; a reversed payment keeps its receipt.
- The person who records an expense or refund is never the one who approves it.
- A parent sees only their own children; a teacher sees only the students they teach.
- Every important action appears in the audit log with who and when.
