const formatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
});

// Models return PostgreSQL DATE values as YYYY-MM-DD strings. Interpret and
// display that same calendar day in UTC so the host timezone cannot shift it.
export const formatProjectDate = (date) => formatter.format(new Date(`${date}T00:00:00Z`));
