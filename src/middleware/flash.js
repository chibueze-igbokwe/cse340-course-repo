// Course-style session flash messages: consumed only when a view renders.
export default function flash(req, res, next) {
  req.flash = function (type, message) {
    if (arguments.length === 2) {
      req.session.flash ||= {};
      (req.session.flash[type] ||= []).push(message);
      return;
    }
    const messages = req.session.flash || {};
    if (type) {
      const result = messages[type] || [];
      delete messages[type];
      return result;
    }
    if (req.session.flash) delete req.session.flash;
    return messages;
  };
  res.locals.flash = req.flash;
  next();
}
