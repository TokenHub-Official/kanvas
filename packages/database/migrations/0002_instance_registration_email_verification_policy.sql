ALTER TABLE `instance_registration_policy`
  ADD COLUMN `email_verification_required` boolean NOT NULL DEFAULT true
  AFTER `email_password_enabled`;
