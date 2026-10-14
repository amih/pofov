// Reads a multipart (or JSON) request into { fields, files: { name: Buffer } }.
export async function readForm(req) {
  if (!req.isMultipart()) return { fields: req.body ?? {}, files: {} };
  const fields = {};
  const files = {};
  for await (const part of req.parts()) {
    if (part.type === 'file') files[part.fieldname] = await part.toBuffer();
    else fields[part.fieldname] = part.value;
  }
  return { fields, files };
}
