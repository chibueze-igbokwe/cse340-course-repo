export const notFound = (req, res, next) => {
  const error = new Error('Page not found');
  error.status = 404;
  next(error);
};

export const testErrorPage = (req, res, next) => {
  next(new Error('This is a test error'));
};

export const errorHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status === 404 ? 404 : 500;
  if (status === 500) console.error('Request failed:', error);
  res.status(status).render('errors/' + status, {
    title: (status === 404 ? 'Page Not Found' : 'Server Error') + ' | Service Network',
    error: error.message,
    stack: error.stack
  });
};
