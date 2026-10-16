-- Legacy summaries have unknown branch coverage and remain readable.
ALTER TABLE agent_thread_memory ADD COLUMN source_message_id CHAR(26) NULL;
