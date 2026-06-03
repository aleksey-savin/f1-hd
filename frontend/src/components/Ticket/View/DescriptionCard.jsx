import { useState } from 'react';
import DOMPurify from 'dompurify';

import Card from 'react-bootstrap/Card';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';

const DescriptionCard = ({ ticket }) => {
    const [showOriginal, setShowOriginal] = useState(false);

    const createMarkup = (html) => ({
        __html: DOMPurify.sanitize(html),
    });

    return (
        <>
            {ticket.description ? (
                <Card>
                    <Card.Body>
                        <p className='lead mb-0'>
                            <span dangerouslySetInnerHTML={createMarkup(ticket.description)} />
                        </p>
                        {ticket.htmlDescription && (
                            <div className='d-flex justify-content-end mt-2'>
                                <Button
                                    size='sm'
                                    variant='outline-secondary'
                                    onClick={() => setShowOriginal(true)}
                                >
                                    Просмотр оригинала
                                </Button>
                            </div>
                        )}
                    </Card.Body>
                </Card>
            ) : (
                <Alert variant='light'>Нет описания</Alert>
            )}

            {ticket.htmlDescription && (
                <Modal
                    centered
                    size='xl'
                    show={showOriginal}
                    onHide={() => setShowOriginal(false)}
                >
                    <Modal.Header closeButton>
                        <Modal.Title>Оригинал</Modal.Title>
                    </Modal.Header>
                    <Modal.Body>
                        <div dangerouslySetInnerHTML={createMarkup(ticket.htmlDescription)} />
                    </Modal.Body>
                    <Modal.Footer>
                        <Button variant='secondary' onClick={() => setShowOriginal(false)}>
                            Закрыть
                        </Button>
                    </Modal.Footer>
                </Modal>
            )}
        </>
    );
};

export default DescriptionCard;
