# Image text remove Workflow acceptance

This is a composition Workflow, not a thirteenth compute Capability. It runs
`image.text.extract`, projects OCR polygons into `image.object.remove.regions`
and returns the object-removal result.

Low OCR confidence remains a successful OCR fact. Product policy may require
review before invoking removal; it must not be represented as Route fallback.
The final result remains generative and keeps the canonical Removed Region Mask
so reviewers can see exactly which text regions were editable.
