import { useFetcher } from 'react-router';
import { useState } from 'react';

import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';

import AlertToast from '../../UI/AlertToast';

const PrefsService = () => {
    const fetcher = useFetcher();
    const [showMessage, setShowMessage] = useState(false);

    const submitHandler = (event) => {
        event.preventDefault();

        fetcher.submit(
            {
                intent: 'update-db-conf',
            },
            { method: 'POST', action: `/preferences` }
        );

        setShowMessage(true);
    };

    return (
        <>
            <Form.Group className='mb-3'>
                <Button
                    onClick={submitHandler}
                    disabled={fetcher.state !== 'idle'}
                >
                    Обновить конфигурацию базы данных
                </Button>
            </Form.Group>
            {fetcher.data?.message && (
                <>
                    <AlertToast
                        show={showMessage}
                        setShow={setShowMessage}
                        variant={fetcher.data.error ? 'danger' : 'success'}
                        message={fetcher.data.message}
                    />
                </>
            )}
        </>
    );
};

export default PrefsService;
