const pool = require('./db');

const saveTokens = async (hub_id, app_id, access_token, refresh_token, expires_in) => {
    // Calculate token expiration time
    const initialExpiresAt = new Date(Date.now() + expires_in * 1000);
    const initialExpiresAtUTC = initialExpiresAt.toISOString();
    const installedAt = new Date().toISOString();
    const query = `
        INSERT INTO sa_application (portal_id, app_id, access_token, refresh_token, expires_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (portal_id) DO UPDATE
        SET app_id = EXCLUDED.app_id,
            access_token = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            expires_at = EXCLUDED.expires_at,
            created_at = EXCLUDED.created_at
    `;
    try {
        await pool.query(query, [hub_id, app_id, access_token, refresh_token, initialExpiresAtUTC, installedAt]);
    } catch (err) {
        console.error('Error saving tokens:', err);
    }
};

const updateTokens = async (hub_id, access_token, refresh_token, expiresAt) => {
    const checkQuery = 'SELECT expires_at FROM sa_application WHERE portal_id = $1';

    try {
        // Log the hub_id to ensure it’s being passed correctly
        console.log(`Updating tokens for hub_id: ${hub_id}`);

        const checkResult = await pool.query(checkQuery, [hub_id]);

        if (checkResult.rowCount > 0) {
            const dbExpiresAt = new Date(checkResult.rows[0].expires_at).toISOString();
            const currentTime = new Date().toISOString();

            // Log expiration check
            console.log(`Token expires at: ${dbExpiresAt}, Current time: ${currentTime}`);

            // Check if the token is expired
            if (dbExpiresAt > currentTime) {
                console.log(`Tokens for account ID: ${hub_id} are still valid. No update required.`);
                return; // Skip the update if the token is still valid
            }
        }

        // Proceed with the update if the token is expired or missing
        const updateQuery = `
            UPDATE sa_application
            SET 
                access_token = $2,
                refresh_token = $3,
                expires_at = $4,
            WHERE portal_id = $1
        `;

        const updateResult = await pool.query(updateQuery, [hub_id, access_token, refresh_token, expiresAt]);


        // Log the result of the update query
        if (updateResult.rowCount > 0) {
            console.log(`Tokens successfully updated for account ID: ${hub_id}`);
        } else {
            console.warn(`No rows found to update for account ID: ${hub_id}`);
        }
    } catch (err) {
        console.error(`Error updating tokens for account ID: ${hub_id}`, err.message);
        throw err;
    }
};

module.exports = { saveTokens, updateTokens };