import React, { useState, useEffect } from 'react';
import { Box, Flex, Tag, Tile, Text, Input, Dropdown, NumberInput, Select, Link, Divider, Image, Button, BarChart, hubspot } from '@hubspot/ui-extensions';

hubspot.extend(({ actions, context  }) => (
  <sampleContactCard fetchProperties={actions.fetchCrmObjectProperties} context={context} />
));

const sampleContactCard = ({ fetchProperties, context }) => {
  const [hsRecordId, setHsRecordId] = useState('');
  const [hsEmail, setHsEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  // Fetch properties directly inside the component without useEffect
  fetchProperties(['hs_object_id', 'email'])
  .then((properties) => {
    setHsRecordId(properties.hs_object_id || '');
    setHsEmail((properties.email || '').toLowerCase());
    setLoading(false);
  })
  .catch(() => {
    setError('Failed to fetch properties');
    setLoading(false);
  });
  if (loading) {
    return <Text>Loading…</Text>;
  }
  if (error) {
    return <Text>{error}</Text>;
  }

  return (
    <>
    <Flex direction={'row'} justify={'start'} align={'center'} wrap={'wrap'} gap={'medium'}>
      <Text>
        Email: <Text format={{ fontWeight: 'bold' }} inline>{hsEmail}</Text>
      </Text>
    </Flex>
   </>
  );
}

export default sampleContactCard;
