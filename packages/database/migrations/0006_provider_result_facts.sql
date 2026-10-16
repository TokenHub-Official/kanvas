-- Keep confirmed Provider result/charge evidence on the existing observation,
-- even when subsequent result download or artifact publication fails.
ALTER TABLE provider_invocation_observation ADD COLUMN result_facts JSON NULL;
