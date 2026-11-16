BEGIN;

-- A primary owner keeps their existing user ID as the household key.
ALTER TABLE users ADD COLUMN household_owner_id UUID REFERENCES users (id) ON DELETE RESTRICT;
CREATE INDEX idx_users_household_owner ON users (household_owner_id)
    WHERE household_owner_id IS NOT NULL;

CREATE FUNCTION shares_camera_household(actor_id UUID, owner_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM users actor JOIN users resource_owner ON resource_owner.id = owner_id
        WHERE actor.id = actor_id AND actor.is_active
          AND COALESCE(actor.household_owner_id, actor.id) =
              COALESCE(resource_owner.household_owner_id, resource_owner.id)
    );
$$;

COMMIT;
